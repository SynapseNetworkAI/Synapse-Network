"""Domain object builders for RuntimeCredentialRecord.

Contains CredentialRuntimeSeed, the private key helpers used by the builders,
and the two builder functions (build_runtime_credential_record,
clone_runtime_credential) that are too large to live in credential_service.py.
"""
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from src.core.common import normalize_wallet
from src.domain.identity import (
    AgentCredentialRecord,
    AgentProfileRecord,
    BudgetPolicyRecord,
    CredentialPatch,
    OwnerAccountRecord,
    RuntimeCredentialRecord,
)
from src.domain.runtime_state import CredentialMetadataState
from src.utils.datetime_utils import now_dt_str, to_dt_str, to_epoch_seconds


@dataclass(frozen=True)
class CredentialRuntimeSeed:
    credential_type: str
    owner_wallet: str
    credential_id: str
    display_name: str
    token_hash_value: str
    token_prefix_value: str
    status: str
    max_calls: int
    calls_used: int
    rpm: int
    credit_limit: Optional[float]
    reset_interval: str
    expiration: Optional[int]
    created_at: str
    updated_at: str
    expires_at: int
    revoked_at: Optional[int]


def _owner_id(wallet: str) -> str:
    return f"owner:{str(wallet or '').lower()}"


def _agent_id(credential_type: str, wallet: str) -> str:
    return f"agent:{str(credential_type or '').lower()}:{str(wallet or '').lower()}"


def _policy_id(credential_id: str) -> str:
    return f"policy:{credential_id}"


def dt_str_to_epoch(value: Optional[str]) -> int:
    """Convert a datetime string to an epoch integer (0 on None/empty)."""
    return to_epoch_seconds(value, default=0)


def _runtime_type(record: RuntimeCredentialRecord) -> str:
    if record.agent.runtime_label:
        return str(record.agent.runtime_label)
    if record.metadata and record.metadata.credential_type:
        return str(record.metadata.credential_type)
    return ""


def _metadata_state(record: RuntimeCredentialRecord) -> CredentialMetadataState:
    if record.metadata is not None:
        return record.metadata
    owner = normalize_wallet(str(record.owner.owner_wallet or ""))
    name = str((record.metadata.name if record.metadata else None) or record.agent.name or "")
    return CredentialMetadataState(
        credential_type=_runtime_type(record),
        owner_address=owner,
        name=name,
        max_calls=0,
        calls_used=0,
        reset_interval="daily",
        expiration=None,
        created_at=record.credential.issued_at,
        updated_at=record.credential.last_used_at,
    )


def _policy_state(record: RuntimeCredentialRecord) -> BudgetPolicyRecord:
    if record.policy is not None:
        return record.policy
    credential_id = str(record.credential.credential_id)
    return BudgetPolicyRecord(
        policy_id=_policy_id(credential_id),
        credential_id=credential_id,
        lifetime_cap_usdc=Decimal("0"),
        daily_cap_usdc=Decimal("0"),
        per_invocation_cap_usdc=Decimal("0"),
        rpm_limit=0,
        qps_limit=0,
        allowed_service_tags=[],
        allowed_service_ids=[],
        blocked_service_ids=[],
        created_at=record.credential.issued_at,
        updated_at=record.credential.last_used_at,
    )


def build_runtime_credential_record(seed: CredentialRuntimeSeed) -> RuntimeCredentialRecord:
    normalized_type = str(seed.credential_type or "").lower()
    normalized_owner = normalize_wallet(seed.owner_wallet)
    owner_id = _owner_id(normalized_owner)
    agent_id = _agent_id(normalized_type, normalized_owner)
    credit_limit_decimal = (
        Decimal(str(round(seed.credit_limit, 6)))
        if seed.credit_limit is not None
        else Decimal("0")
    )

    return RuntimeCredentialRecord(
        owner=OwnerAccountRecord(
            owner_id=owner_id,
            owner_wallet=normalized_owner,
            status="active",
            default_currency="USDC",
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
        agent=AgentProfileRecord(
            agent_id=agent_id,
            owner_id=owner_id,
            name=f"{normalized_type}-runtime",
            purpose=f"{normalized_type} runtime credential holder",
            status="active",
            runtime_label=normalized_type,
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
        credential=AgentCredentialRecord(
            credential_id=seed.credential_id,
            agent_id=agent_id,
            secret_hash=seed.token_hash_value,
            secret_prefix=seed.token_prefix_value,
            status=seed.status,
            issued_at=seed.created_at,
            expires_at=to_dt_str(seed.expires_at),
            revoked_at=str(seed.revoked_at) if seed.revoked_at is not None else None,
            last_used_at=seed.updated_at,
        ),
        policy=BudgetPolicyRecord(
            policy_id=_policy_id(seed.credential_id),
            credential_id=seed.credential_id,
            lifetime_cap_usdc=credit_limit_decimal,
            daily_cap_usdc=credit_limit_decimal,
            per_invocation_cap_usdc=credit_limit_decimal,
            rpm_limit=seed.rpm,
            qps_limit=max(0, seed.rpm),
            allowed_service_tags=[],
            allowed_service_ids=[],
            blocked_service_ids=[],
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
        metadata=CredentialMetadataState(
            credential_type=normalized_type,
            owner_address=normalized_owner,
            name=seed.display_name,
            max_calls=seed.max_calls,
            calls_used=seed.calls_used,
            reset_interval=seed.reset_interval,
            expiration=seed.expiration,
            created_at=seed.created_at,
            updated_at=seed.updated_at,
        ),
    )


def clone_runtime_credential(
    record: RuntimeCredentialRecord,
    patch: CredentialPatch,
) -> RuntimeCredentialRecord:
    metadata = _metadata_state(record)
    policy = _policy_state(record)
    effective_updated_at = to_dt_str(patch.updated_at, now_dt_str())
    effective_calls_used = patch.calls_used if patch.calls_used is not None else int(metadata.calls_used or 0)
    effective_max_calls = patch.max_calls if patch.max_calls is not None else int(metadata.max_calls or 0)
    effective_reset_interval = patch.reset_interval if patch.reset_interval is not None else str(metadata.reset_interval or "daily")
    effective_expiration = patch.expiration if patch.expiration is not None else metadata.expiration
    effective_credit_limit = (
        Decimal(str(round(patch.credit_limit, 6))) if patch.credit_limit is not None else policy.lifetime_cap_usdc
    )
    effective_rpm = patch.rpm if patch.rpm is not None else policy.rpm_limit
    effective_expires_at = patch.expires_at if patch.expires_at is not None else dt_str_to_epoch(record.credential.expires_at)

    return record.model_copy(
        update={
            "owner": record.owner.model_copy(update={"updated_at": effective_updated_at}),
            "agent": record.agent.model_copy(update={"updated_at": effective_updated_at}),
            "credential": record.credential.model_copy(
                update={
                    "secret_hash": patch.secret_hash or record.credential.secret_hash,
                    "secret_prefix": patch.secret_prefix or record.credential.secret_prefix,
                    "status": patch.status or record.credential.status,
                    "issued_at": patch.issued_at or record.credential.issued_at,
                    "expires_at": to_dt_str(effective_expires_at),
                    "revoked_at": None
                    if patch.clear_revoked_at
                    else (str(patch.revoked_at) if patch.revoked_at is not None else record.credential.revoked_at),
                    "last_used_at": effective_updated_at,
                }
            ),
            "policy": policy.model_copy(
                update={
                    "lifetime_cap_usdc": effective_credit_limit,
                    "daily_cap_usdc": effective_credit_limit,
                    "per_invocation_cap_usdc": effective_credit_limit,
                    "rpm_limit": int(effective_rpm),
                    "qps_limit": max(0, int(effective_rpm)),
                    "updated_at": effective_updated_at,
                }
            ),
            "metadata": metadata.model_copy(
                update={
                    "calls_used": effective_calls_used,
                    "max_calls": effective_max_calls,
                    "reset_interval": effective_reset_interval,
                    "expiration": effective_expiration,
                    "updated_at": effective_updated_at,
                }
            ),
        }
    )
