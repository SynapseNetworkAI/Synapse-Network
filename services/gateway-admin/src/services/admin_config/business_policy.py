from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from src.core.errors import AuthorizationError, BadRequestError
from src.domain import AdminActionAudit, AdminDocumentConfigSnapshot
from src.domain.enums import AuditResultStatus
from src.services.adapters.business_policy import (
    BusinessPolicyAdapter,
    BusinessPolicyAdapterError,
)
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore


BUSINESS_POLICY_CONFIG_KEY = "business_policy_config"
DRAFT_READ_ROLES = {"super_admin", "platform_ops_admin"}
WRITE_ROLES = {"super_admin"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_money(value: Any, fallback: str) -> str:
    try:
        return f"{Decimal(str(value)).quantize(Decimal('0.000001'))}"
    except Exception:
        return fallback


def default_business_policy_payload() -> dict[str, Any]:
    return {
        "finance": {
            "platformFeeRate": "0.100000",
            "gatewayRoutingTaxUsdc": "0.000100",
            "consumerWithdrawFeeUsdc": "0.500000",
            "consumerDepositMinUsdc": "5.000000",
        },
        "consumerWithdraw": {
            "minUsdc": "10.000000",
            "manualReviewThresholdUsdc": "500.000000",
            "maxDailyCount": 3,
            "maturitySeconds": 604800,
        },
        "risk": {
            "withdrawalAutoSingleLimitUsdc": "100.000000",
            "withdrawalAuto24hLimitUsdc": "500.000000",
            "withdrawalWindowHours": 24,
        },
        "reconciliation": {
            "alertDeltaUsdc": "1.000000",
        },
    }


def normalize_business_policy_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    source = payload if isinstance(payload, dict) else {}
    defaults = default_business_policy_payload()
    finance = source.get("finance") if isinstance(source.get("finance"), dict) else {}
    consumer_withdraw = source.get("consumerWithdraw") if isinstance(source.get("consumerWithdraw"), dict) else {}
    risk = source.get("risk") if isinstance(source.get("risk"), dict) else {}
    reconciliation = source.get("reconciliation") if isinstance(source.get("reconciliation"), dict) else {}
    return {
        "finance": {
            "platformFeeRate": _as_money(
                finance.get("platformFeeRate"), defaults["finance"]["platformFeeRate"]
            ),
            "gatewayRoutingTaxUsdc": _as_money(
                finance.get("gatewayRoutingTaxUsdc"),
                defaults["finance"]["gatewayRoutingTaxUsdc"],
            ),
            "consumerWithdrawFeeUsdc": _as_money(
                finance.get("consumerWithdrawFeeUsdc"),
                defaults["finance"]["consumerWithdrawFeeUsdc"],
            ),
            "consumerDepositMinUsdc": _as_money(
                finance.get("consumerDepositMinUsdc"),
                defaults["finance"]["consumerDepositMinUsdc"],
            ),
        },
        "consumerWithdraw": {
            "minUsdc": _as_money(
                consumer_withdraw.get("minUsdc"),
                defaults["consumerWithdraw"]["minUsdc"],
            ),
            "manualReviewThresholdUsdc": _as_money(
                consumer_withdraw.get("manualReviewThresholdUsdc"),
                defaults["consumerWithdraw"]["manualReviewThresholdUsdc"],
            ),
            "maxDailyCount": max(
                1,
                int(consumer_withdraw.get("maxDailyCount", defaults["consumerWithdraw"]["maxDailyCount"])),
            ),
            "maturitySeconds": max(
                0,
                int(consumer_withdraw.get("maturitySeconds", defaults["consumerWithdraw"]["maturitySeconds"])),
            ),
        },
        "risk": {
            "withdrawalAutoSingleLimitUsdc": _as_money(
                risk.get("withdrawalAutoSingleLimitUsdc"),
                defaults["risk"]["withdrawalAutoSingleLimitUsdc"],
            ),
            "withdrawalAuto24hLimitUsdc": _as_money(
                risk.get("withdrawalAuto24hLimitUsdc"),
                defaults["risk"]["withdrawalAuto24hLimitUsdc"],
            ),
            "withdrawalWindowHours": max(
                1, int(risk.get("withdrawalWindowHours", defaults["risk"]["withdrawalWindowHours"]))
            ),
        },
        "reconciliation": {
            "alertDeltaUsdc": _as_money(
                reconciliation.get("alertDeltaUsdc"),
                defaults["reconciliation"]["alertDeltaUsdc"],
            )
        },
    }


def validate_business_policy_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    normalized = normalize_business_policy_payload(payload)
    platform_fee_rate = Decimal(normalized["finance"]["platformFeeRate"])
    if platform_fee_rate < Decimal("0") or platform_fee_rate > Decimal("1"):
        raise BadRequestError("platformFeeRate must be within [0,1]")
    if Decimal(normalized["finance"]["consumerWithdrawFeeUsdc"]) >= Decimal(
        normalized["consumerWithdraw"]["manualReviewThresholdUsdc"]
    ):
        raise BadRequestError(
            "consumerWithdrawFeeUsdc must be lower than manualReviewThresholdUsdc"
        )
    return normalized


class BusinessPolicyConfigService:
    def __init__(self, store: AdminStore, adapter: BusinessPolicyAdapter) -> None:
        self._store = store
        self._adapter = adapter

    def get_policy(self, operator: AdminIdentity, stage: str = "draft") -> dict[str, Any]:
        normalized_stage = (stage or "draft").strip().lower()
        if normalized_stage not in {"draft", "published"}:
            raise BadRequestError("Unsupported config stage")
        self._ensure_role(operator, DRAFT_READ_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        payload = snapshot.draft_payload if normalized_stage == "draft" else snapshot.published_payload
        return {"policy": payload, "meta": self._serialize_meta(snapshot)}

    def update_policy(self, operator: AdminIdentity, payload: dict[str, Any]) -> dict[str, Any]:
        self._ensure_role(operator, WRITE_ROLES)
        current = self._get_or_create_snapshot(operator.admin_id)
        next_payload = validate_business_policy_payload(payload)
        saved = self._store.config.save_document_config(
            replace(
                current,
                draft_payload=next_payload,
                draft_version=current.draft_version + 1,
                updated_at=_utcnow(),
                updated_by=operator.admin_id,
            )
        )
        self._append_audit(
            operator,
            "business_policy_config.update",
            current.draft_payload,
            next_payload,
        )
        return {"policy": saved.draft_payload, "meta": self._serialize_meta(saved)}

    def publish_policy(self, operator: AdminIdentity) -> dict[str, Any]:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        try:
            gateway_response = self._adapter.publish_policy(
                operator=operator,
                policy=snapshot.draft_payload,
                published_version=snapshot.draft_version,
            )
        except BusinessPolicyAdapterError as exc:
            raise BadRequestError(str(exc)) from exc
        saved = self._store.config.save_document_config(
            replace(
                snapshot,
                published_payload=snapshot.draft_payload,
                published_version=snapshot.draft_version,
                updated_at=_utcnow(),
                updated_by=operator.admin_id,
                published_at=_utcnow(),
                published_by=operator.admin_id,
            )
        )
        self._append_audit(
            operator,
            "business_policy_config.publish",
            {"publishedVersion": snapshot.published_version},
            {
                "publishedVersion": saved.published_version,
                "gatewaySource": gateway_response.get("source"),
            },
        )
        return {
            "policy": saved.published_payload,
            "meta": self._serialize_meta(saved),
            "runtime": gateway_response,
        }

    def get_overview(self, operator: AdminIdentity) -> dict[str, Any]:
        self._ensure_role(operator, DRAFT_READ_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        try:
            runtime = self._adapter.get_overview(operator)
        except BusinessPolicyAdapterError as exc:
            runtime = {
                "status": "degraded",
                "error": {"code": exc.code, "message": str(exc)},
                "businessPolicy": None,
                "envSummary": {},
            }
        return {
            "draft": {
                "policy": snapshot.draft_payload,
                "meta": self._serialize_meta(snapshot),
            },
            "published": {
                "policy": snapshot.published_payload,
                "meta": self._serialize_meta(snapshot),
            },
            "runtime": runtime,
        }

    def _get_or_create_snapshot(self, operator_id: str | None) -> AdminDocumentConfigSnapshot:
        snapshot = self._store.config.get_document_config(BUSINESS_POLICY_CONFIG_KEY)
        if snapshot is not None:
            return snapshot
        now = _utcnow()
        payload = default_business_policy_payload()
        return self._store.config.save_document_config(
            AdminDocumentConfigSnapshot(
                config_key=BUSINESS_POLICY_CONFIG_KEY,
                draft_payload=payload,
                published_payload=payload,
                draft_version=1,
                published_version=1,
                created_at=now,
                updated_at=now,
                updated_by=operator_id or "system_seed",
                published_at=now,
                published_by=operator_id or "system_seed",
            )
        )

    @staticmethod
    def _serialize_meta(snapshot: AdminDocumentConfigSnapshot) -> dict[str, Any]:
        return {
            "draftVersion": snapshot.draft_version,
            "publishedVersion": snapshot.published_version,
            "isDirty": snapshot.draft_payload != snapshot.published_payload,
            "updatedAt": _serialize_timestamp(snapshot.updated_at),
            "publishedAt": _serialize_timestamp(snapshot.published_at),
            "updatedBy": snapshot.updated_by,
            "publishedBy": snapshot.published_by,
        }

    def _append_audit(
        self,
        operator: AdminIdentity,
        action_type: str,
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> None:
        self._store.audit.append_action(
            AdminActionAudit(
                action_type=action_type,
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="business_policy_config",
                resource_id=BUSINESS_POLICY_CONFIG_KEY,
                before=before,
                after=after,
                created_at=_utcnow(),
            )
        )

    @staticmethod
    def _ensure_role(operator: AdminIdentity, allowed_roles: set[str]) -> None:
        if operator.role not in allowed_roles:
            raise AuthorizationError("Admin role is not allowed to manage business policy config")


def _serialize_timestamp(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None
