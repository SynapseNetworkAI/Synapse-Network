from __future__ import annotations

import base64
import hmac
import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from src.core.config import get_settings
from src.services.ops.lark_alerts import LarkAlertError, LarkRoute, sanitize_payload, send_lark_alert

router = APIRouter(prefix="/api/v1/ops/webhooks", tags=["ops-webhooks"])
logger = logging.getLogger(__name__)

ROUTE_NAMES = {"staging-drill", "p0-war-room", "prod-alerts"}


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_str(value: Any, fallback: str = "") -> str:
    return str(value if value is not None else fallback).strip()


def _parse_basic_auth(authorization: str | None) -> tuple[str, str] | None:
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    try:
        decoded = base64.b64decode(authorization.split(" ", 1)[1]).decode("utf-8")
    except Exception:
        return None
    if ":" not in decoded:
        return None
    username, password = decoded.split(":", 1)
    return username, password


def _is_authorized(
    *,
    token_header: str | None,
    authorization: str | None,
) -> bool:
    settings = get_settings()
    expected = settings.gcp_alert_receiver_token.strip()
    if not expected:
        return False
    if token_header and hmac.compare_digest(token_header.strip(), expected):
        return True
    parsed = _parse_basic_auth(authorization)
    if parsed is None:
        return False
    username, password = parsed
    return hmac.compare_digest(username, settings.gcp_alert_receiver_username) and hmac.compare_digest(password, expected)


def _route_from_payload(payload: dict[str, Any]) -> str:
    settings = get_settings()
    incident = _as_dict(payload.get("incident"))
    metadata = _as_dict(incident.get("metadata"))
    labels = {
        **_as_dict(metadata.get("user_labels")),
        **_as_dict(payload.get("userLabels")),
        **_as_dict(payload.get("labels")),
    }
    route = _safe_str(labels.get("route") or labels.get("lark_route") or settings.gcp_alert_default_route, "staging-drill")
    return route if route in ROUTE_NAMES else "staging-drill"


def _route_config(route_name: str) -> LarkRoute:
    settings = get_settings()
    if route_name == "p0-war-room":
        return LarkRoute(
            name="p0-war-room",
            webhook=settings.lark_webhook_p0_war_room,
            secret=settings.lark_secret_p0_war_room,
        )
    if route_name == "prod-alerts":
        return LarkRoute(
            name="prod-alerts",
            webhook=settings.lark_webhook_prod_alerts,
            secret=settings.lark_secret_prod_alerts,
        )
    return LarkRoute(
        name="staging-drill",
        webhook=settings.lark_webhook_staging_drill,
        secret=settings.lark_secret_staging_drill,
    )


def normalize_gcp_monitoring_payload(payload: dict[str, Any]) -> dict[str, Any]:
    incident = _as_dict(payload.get("incident"))
    resource = _as_dict(incident.get("resource"))
    resource_labels = _as_dict(resource.get("labels"))
    metadata = _as_dict(incident.get("metadata"))
    user_labels = _as_dict(metadata.get("user_labels"))
    policy_user_labels = _as_dict(incident.get("policy_user_labels"))
    labels = {
        "alertname": _safe_str(
            user_labels.get("alertname")
            or policy_user_labels.get("alertname")
            or incident.get("policy_name")
            or incident.get("condition_name")
            or "GcpMonitoringAlert"
        ),
        "severity": _safe_str(user_labels.get("severity") or policy_user_labels.get("severity") or "p1"),
        "system": _safe_str(user_labels.get("system") or policy_user_labels.get("system") or "ops"),
        "env": _safe_str(user_labels.get("env") or policy_user_labels.get("env") or "staging"),
        "resource_type": _safe_str(resource.get("type") or incident.get("resource_type") or "unknown"),
        "service_name": _safe_str(resource_labels.get("service_name") or resource_labels.get("service") or "unknown"),
    }
    documentation = _safe_str(incident.get("documentation") or payload.get("documentation") or "")
    summary = _safe_str(
        incident.get("summary")
        or incident.get("condition_name")
        or payload.get("summary")
        or "GCP Monitoring alert fired."
    )
    state = _safe_str(incident.get("state") or payload.get("state") or "open").lower()
    status = "resolved" if state in {"closed", "resolved"} else "firing"
    annotations = {
        "summary": summary,
        "business_scenario": _safe_str(user_labels.get("business_scenario") or policy_user_labels.get("business_scenario") or "Staging infrastructure alert drill."),
        "impact": _safe_str(user_labels.get("impact") or policy_user_labels.get("impact") or "NO_ACTION_REQUIRED for staging drill unless this is an unexpected alert."),
        "trigger": _safe_str(user_labels.get("trigger") or policy_user_labels.get("trigger") or incident.get("condition_name") or "GCP Monitoring policy matched."),
        "action": _safe_str(user_labels.get("action") or policy_user_labels.get("action") or "Check Cloud Run logs, Gateway health, and the staging validation runbook."),
        "runbook": _safe_str(user_labels.get("runbook") or policy_user_labels.get("runbook") or "docs/ops/13_Production_Monitoring_Alerting_and_Backup_Restore.md"),
        "dashboard": _safe_str(incident.get("url") or payload.get("url") or "not configured"),
        "message": documentation,
    }
    return sanitize_payload(
        {
            "status": status,
            "labels": labels,
            "annotations": annotations,
            "fingerprint": _safe_str(incident.get("incident_id") or incident.get("scoping_project_id") or ""),
        }
    )


@router.post("/gcp-alert-receiver")
async def receive_gcp_alert(
    request: Request,
    x_synapse_gcp_alert_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.gcp_alert_receiver_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    if not _is_authorized(
        token_header=x_synapse_gcp_alert_token,
        authorization=authorization,
    ):
        raise HTTPException(status_code=401, detail="Invalid alert receiver token")

    payload = _as_dict(await request.json())
    route_name = _route_from_payload(payload)
    alert = normalize_gcp_monitoring_payload(payload)
    try:
        result = await send_lark_alert(_route_config(route_name), alert)
    except LarkAlertError as exc:
        raise HTTPException(status_code=502, detail="Lark alert delivery failed") from exc
    labels = _as_dict(alert.get("labels"))
    logger.error(
        "alert_trigger=GCP_ALERT_RECEIVED env=%s alertname=%s route=%s severity=%s",
        _safe_str(labels.get("env"), "unknown"),
        _safe_str(labels.get("alertname"), "unknown"),
        route_name,
        _safe_str(labels.get("severity"), "unknown"),
    )

    return {"success": True, "route": route_name, "delivery": result}
