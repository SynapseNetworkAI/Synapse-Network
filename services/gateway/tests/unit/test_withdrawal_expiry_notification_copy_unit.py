from __future__ import annotations

from src.services.notifications.in_app import (
    build_consumer_withdrawal_failed_expired_intent,
    build_provider_withdrawal_failed_expired_intent,
)
from src.services.notifications.templates import render_notification_email
from src.services.notifications.transactional import TRANSACTION_EMAIL_TEMPLATES


def test_withdrawal_expiry_notifications_explain_funds_returned() -> None:
    consumer = build_consumer_withdrawal_failed_expired_intent(
        "0xABC",
        {"withdrawalId": "cw-1", "amount": "500.000000"},
    )
    provider = build_provider_withdrawal_failed_expired_intent(
        "0xABC",
        {"withdrawalId": "pw-1", "amount": "2.000000"},
    )

    assert "Frozen funds were safely returned to your available balance" in consumer.body
    assert consumer.payload["status"] == "FAILED_EXPIRED"
    assert "Frozen earnings were safely returned to your withdrawable balance" in provider.body
    assert provider.payload["status"] == "FAILED_EXPIRED"


def test_withdrawal_expiry_email_templates_are_transactional_and_reassuring() -> None:
    assert "consumer_withdrawal_failed_expired" in TRANSACTION_EMAIL_TEMPLATES
    assert "provider_withdrawal_failed_expired" in TRANSACTION_EMAIL_TEMPLATES

    consumer_email = render_notification_email(
        "consumer_withdrawal_failed_expired",
        {
            "withdrawalId": "cw-1",
            "amount": "500.000000 USDC",
            "status": "FAILED_EXPIRED",
            "message": "Frozen funds were safely returned to your available balance.",
        },
    )
    provider_email = render_notification_email(
        "provider_withdrawal_failed_expired",
        {
            "withdrawalId": "pw-1",
            "amount": "2.000000 USDC",
            "status": "FAILED_EXPIRED",
            "message": "Frozen earnings were safely returned to your withdrawable balance.",
        },
    )

    assert "Frozen funds were safely returned to your available balance" in consumer_email.text_body
    assert "Frozen earnings were safely returned to your withdrawable balance" in provider_email.text_body
