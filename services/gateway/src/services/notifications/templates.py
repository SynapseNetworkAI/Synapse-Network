from __future__ import annotations

from typing import Any

from .models import RenderedEmail, UnknownNotificationTemplate
from .sanitizer import redact_payload, redact_text


_TEMPLATE_TITLES = {
    "consumer_withdrawal_ticket_ready": "Your withdrawal is ready to claim",
    "consumer_withdrawal_completed": "Your withdrawal is complete",
    "consumer_withdrawal_failed_expired": "Your withdrawal expired and funds were returned",
    "provider_withdrawal_ticket_ready": "Your provider withdrawal is ready to claim",
    "provider_withdrawal_rejected": "Your provider withdrawal was rejected",
    "provider_withdrawal_completed": "Your provider withdrawal is complete",
    "deposit_confirmed": "Your deposit is confirmed",
    "deposit_delayed": "Your deposit is taking longer than expected",
    "refund_completed": "Your refund is complete",
    "security_event": "Security alert for your Synapse account",
    "admin_withdrawal_review_pending": "Withdrawal review is pending",
    "admin_approval_failed": "Admin approval action failed",
    "admin_reconciliation_delta": "Finance reconciliation requires attention",
}


def _line(label: str, value: Any) -> str | None:
    if value is None or value == "":
        return None
    return f"{label}: {redact_text(str(value), max_chars=300)}"


def render_notification_email(template_key: str, payload: dict[str, Any]) -> RenderedEmail:
    sanitized = redact_payload(payload)
    title = _TEMPLATE_TITLES.get(template_key)
    if not title:
        raise UnknownNotificationTemplate

    amount = sanitized.get("amount")
    status = sanitized.get("status")
    resource_id = sanitized.get("withdrawalId") or sanitized.get("depositId") or sanitized.get("requestId")
    tx_hash = sanitized.get("txHash")
    action_url = sanitized.get("actionUrl")
    reason = sanitized.get("reason")

    lines = [
        title,
        "",
        _line("Status", status),
        _line("Amount", amount),
        _line("Reference", resource_id),
        _line("Transaction", tx_hash),
        _line("Reason", reason),
    ]
    if action_url:
        lines.extend(["", f"Open Synapse: {redact_text(str(action_url), max_chars=500)}"])
    lines.extend(
        [
            "",
            "Security note: Synapse will never email private keys, raw withdrawal tickets, or signatures.",
        ]
    )
    text_body = "\n".join(line for line in lines if line is not None)
    html_body = "<br/>".join(
        redact_text(line, max_chars=800) for line in text_body.splitlines()
    )
    return RenderedEmail(subject=f"Synapse: {title}", text_body=text_body, html_body=html_body)
