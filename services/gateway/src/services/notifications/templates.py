from __future__ import annotations

import html
from typing import Any

from src.core.config import settings

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
    "email_verification": "Verify your email",
    "email_bound_success": "Your email is verified",
    "email_changed_notice": "Your Synapse email was changed",
    "email_removed_notice": "Your Synapse email was removed",
    "security_event": "Security alert for your Synapse account",
    "admin_withdrawal_review_pending": "Withdrawal review is pending",
    "admin_approval_failed": "Admin approval action failed",
    "admin_reconciliation_delta": "Finance reconciliation requires attention",
    "support_reply": "Synapse support replied",
}

_MONEY_TEMPLATE_SUBJECTS = {
    "deposit_confirmed": "Your deposit is confirmed",
    "refund_completed": "Your refund is complete",
    "consumer_withdrawal_ticket_ready": "Your withdrawal is ready to claim",
    "consumer_withdrawal_completed": "Your withdrawal is complete",
    "consumer_withdrawal_failed_expired": "Your withdrawal expired and funds were returned",
    "provider_withdrawal_ticket_ready": "Your provider withdrawal is ready to claim",
    "provider_withdrawal_completed": "Your provider withdrawal is complete",
    "provider_withdrawal_rejected": "Your provider withdrawal was rejected",
}
SHORT_HASH_PLAIN_THRESHOLD = 18


def _line(label: str, value: Any) -> str | None:
    if value is None or value == "":
        return None
    return f"{label}: {redact_text(str(value), max_chars=300)}"


def _short_hash(value: Any) -> str:
    text = redact_text(str(value or ""), max_chars=120)
    if len(text) <= SHORT_HASH_PLAIN_THRESHOLD or text.startswith("[REDACTED"):
        return text
    return f"{text[:10]}...{text[-6:]}"


def _html(value: Any) -> str:
    return html.escape(redact_text(str(value or ""), max_chars=800), quote=True)


def _render_receipt_html(*, title: str, payload: dict[str, Any]) -> str:
    amount = payload.get("amount") or payload.get("amountUsdc") or "0.000000 USDC"
    status = payload.get("status") or "confirmed"
    resource_id = (
        payload.get("withdrawalId")
        or payload.get("depositId")
        or payload.get("refundId")
        or payload.get("requestId")
        or "n/a"
    )
    tx_hash = payload.get("txHash") or payload.get("transactionHash") or ""
    network = payload.get("network") or payload.get("chain") or "Arbitrum Sepolia"
    wallet = payload.get("wallet") or payload.get("ownerAddress") or payload.get("owner") or ""
    action_url = payload.get("actionUrl") or settings.public_app_base_url or "https://synapse-network.ai"
    details = [
        ("Reference", resource_id),
        ("Status", status),
        ("Network", network),
    ]
    if tx_hash:
        details.append(("Transaction", _short_hash(tx_hash)))
    if wallet:
        details.append(("Wallet", _short_hash(wallet)))
    rows = "\n".join(
        f"<tr><td>{_html(label)}</td><td>{_html(value)}</td></tr>" for label, value in details
    )
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#050505;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="padding:40px 18px;">
      <div style="max-width:560px;margin:0 auto;">
        <div style="color:#fff;font-weight:700;font-size:18px;margin:0 0 24px;">Synapse Network</div>
        <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 12px 40px rgba(0,0,0,.28);">
          <div style="color:#737373;font-size:14px;font-weight:700;margin-bottom:8px;">Receipt from Synapse Network</div>
          <div style="font-size:38px;line-height:1.1;font-weight:800;margin-bottom:8px;">{_html(amount)}</div>
          <div style="color:#777;font-size:14px;font-weight:700;margin-bottom:24px;">{_html(title)}</div>
          <div style="border-top:1px solid #e7e7e7;margin:0 0 22px;"></div>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            {rows}
          </table>
          <div style="border-top:1px solid #e7e7e7;margin:24px 0;"></div>
          <a href="{_html(action_url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">Open Synapse</a>
        </div>
        <div style="background:#fff;border-radius:16px;padding:28px 32px;margin-top:20px;">
          <div style="font-weight:800;margin-bottom:18px;">Receipt details</div>
          <div style="color:#777;font-size:13px;line-height:1.6;">Questions? Visit Synapse support or reply to this email. Security note: Synapse will never email private keys, raw withdrawal tickets, or signatures.</div>
        </div>
      </div>
    </div>
  </body>
</html>"""


def _render_verification_html(*, title: str, payload: dict[str, Any]) -> str:
    code = payload.get("verificationCode") or "000000"
    expires_minutes = payload.get("expiresInMinutes") or "10"
    wallet = payload.get("wallet") or payload.get("ownerAddress") or ""
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#050505;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="padding:40px 18px;max-width:560px;margin:0 auto;">
      <div style="color:#fff;font-weight:700;font-size:18px;margin:0 0 24px;">Synapse Network</div>
      <div style="background:#fff;border-radius:16px;padding:32px;">
        <div style="font-size:28px;font-weight:800;margin-bottom:12px;">{_html(title)}</div>
        <p style="color:#555;line-height:1.6;">Enter this code in the Synapse settings dialog to bind this email to your wallet.</p>
        <div style="letter-spacing:0.22em;font-size:38px;line-height:1.1;font-weight:900;margin:24px 0;padding:18px 20px;border-radius:14px;background:#f3f5f7;text-align:center;">{_html(code)}</div>
        <p style="color:#777;font-size:13px;line-height:1.6;">This code expires in {_html(expires_minutes)} minutes. Wallet: {_html(_short_hash(wallet))}</p>
        <p style="color:#777;font-size:13px;line-height:1.6;margin-top:24px;">If you did not request this, you can ignore this email.</p>
      </div>
    </div>
  </body>
</html>"""


def _render_support_reply_html(*, title: str, payload: dict[str, Any]) -> str:
    action_url = payload.get("actionUrl") or settings.public_app_base_url or "https://synapse-network.ai"
    topic_title = payload.get("title") or "Support case"
    preview = payload.get("messagePreview") or ""
    feedback_id = payload.get("feedbackId") or payload.get("responseTaskId") or ""
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#050505;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="padding:40px 18px;max-width:560px;margin:0 auto;">
      <div style="color:#fff;font-weight:700;font-size:18px;margin:0 0 24px;">Synapse Network</div>
      <div style="background:#fff;border-radius:16px;padding:32px;">
        <div style="font-size:28px;font-weight:800;margin-bottom:12px;">{_html(title)}</div>
        <p style="color:#555;line-height:1.6;">Our support team replied to your case.</p>
        <div style="border-top:1px solid #e7e7e7;margin:22px 0;"></div>
        <div style="color:#737373;font-size:13px;font-weight:700;margin-bottom:6px;">Case</div>
        <div style="font-weight:800;margin-bottom:14px;">{_html(topic_title)}</div>
        <div style="color:#555;line-height:1.6;margin-bottom:18px;">{_html(preview)}</div>
        <div style="color:#777;font-size:13px;margin-bottom:22px;">Reference: {_html(feedback_id)}</div>
        <a href="{_html(action_url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">Open support reply</a>
      </div>
    </div>
  </body>
</html>"""


def _render_account_email_html(*, title: str, payload: dict[str, Any]) -> str:
    action_url = payload.get("actionUrl") or settings.public_app_base_url or "https://synapse-network.ai"
    wallet = payload.get("wallet") or payload.get("ownerAddress") or ""
    email_masked = payload.get("emailMasked") or payload.get("previousEmailMasked") or ""
    explanation = payload.get("message") or "This account email change was authorized by your wallet."
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#050505;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div style="padding:40px 18px;max-width:560px;margin:0 auto;">
      <div style="color:#fff;font-weight:700;font-size:18px;margin:0 0 24px;">Synapse Network</div>
      <div style="background:#fff;border-radius:16px;padding:32px;">
        <div style="font-size:28px;font-weight:800;margin-bottom:12px;">{_html(title)}</div>
        <p style="color:#555;line-height:1.6;">{_html(explanation)}</p>
        <div style="border-top:1px solid #e7e7e7;margin:22px 0;"></div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="color:#777;padding:6px 0;">Email</td><td style="padding:6px 0;text-align:right;">{_html(email_masked)}</td></tr>
          <tr><td style="color:#777;padding:6px 0;">Wallet</td><td style="padding:6px 0;text-align:right;">{_html(_short_hash(wallet))}</td></tr>
        </table>
        <div style="border-top:1px solid #e7e7e7;margin:24px 0;"></div>
        <a href="{_html(action_url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">Open account settings</a>
      </div>
    </div>
  </body>
</html>"""


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
        _line("Code", sanitized.get("verificationCode")),
        _line("Status", status),
        _line("Amount", amount),
        _line("Reference", resource_id),
        _line("Transaction", tx_hash),
        _line("Reason", reason),
        _line("Message", sanitized.get("message")),
        _line("Wallet", sanitized.get("wallet") or sanitized.get("ownerAddress")),
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
    if template_key in _MONEY_TEMPLATE_SUBJECTS:
        html_body = _render_receipt_html(title=title, payload=sanitized)
    elif template_key == "email_verification":
        html_body = _render_verification_html(title=title, payload=sanitized)
    elif template_key in {"email_bound_success", "email_changed_notice", "email_removed_notice"}:
        html_body = _render_account_email_html(title=title, payload=sanitized)
    elif template_key == "support_reply":
        html_body = _render_support_reply_html(title=title, payload=sanitized)
    else:
        html_body = "<br/>".join(
            _html(line) for line in text_body.splitlines()
        )
    return RenderedEmail(subject=f"SynapseNetwork: {title}", text_body=text_body, html_body=html_body)
