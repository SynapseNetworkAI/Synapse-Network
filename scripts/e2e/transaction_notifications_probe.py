from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any

from src.core.common import normalize_wallet
from src.services.notifications.models import (
    EmailSendResult,
    InAppNotificationIntent,
    RenderedEmail,
)
from src.services.notifications.outbox_worker import drain_notification_outbox_once
from src.services.notifications.sender import GmailSmtpSender
from src.services.notifications.templates import render_notification_email
from src.services.notifications.transactional import (
    _send_lark_transaction_event,
    enqueue_transaction_email,
)
from src.storage.postgres_impl import PostgresStorage


DEFAULT_OWNER_WALLET = "0x000000000000000000000000000000000000e2e1"
DEFAULT_LOCAL_EMAIL = "transaction-e2e@synapse.test"


@dataclass
class FakeEmailSender:
    run_id: str
    sent: list[dict[str, Any]] = field(default_factory=list)

    def send(self, *, recipient_email: str, rendered: RenderedEmail) -> EmailSendResult:
        message_id = f"fake-email-{self.run_id}-{len(self.sent) + 1}"
        self.sent.append(
            {
                "messageId": message_id,
                "subject": rendered.subject,
                "htmlContainsReceipt": "Receipt from Synapse Network" in rendered.html_body,
            }
        )
        return EmailSendResult(
            message_id=message_id,
            provider_response={
                "transport": "fake",
                "accepted": True,
                "runId": self.run_id,
                "subject": rendered.subject,
            },
        )


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(name)
    return value


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _seed_verified_owner(
    storage: PostgresStorage,
    *,
    owner_wallet: str,
    email: str,
    run_id: str,
) -> tuple[str, str]:
    normalized_email = email.strip().lower()
    normalized_wallet = normalize_wallet(owner_wallet)
    with storage._db.tx_cursor() as cur:  # noqa: SLF001 - E2E harness needs setup SQL.
        cur.execute(
            """
            SELECT owner_id, owner_wallet
            FROM synapse_owner_accounts
            WHERE lower(email) = lower(%s)
            LIMIT 1
            """,
            (normalized_email,),
        )
        row = cur.fetchone()
        if row:
            owner_id = str(row[0])
            existing_wallet = normalize_wallet(str(row[1]))
            cur.execute(
                """
                UPDATE synapse_owner_accounts
                SET email_verified = TRUE,
                    notify_alerts = TRUE,
                    updated_at = NOW()
                WHERE owner_id = %s
                """,
                (owner_id,),
            )
            return owner_id, existing_wallet

        owner_id = f"owner:{normalized_wallet}"
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id,
                owner_wallet,
                display_name,
                email,
                email_verified,
                notify_marketing,
                notify_alerts,
                status,
                default_currency,
                created_at,
                updated_at
            ) VALUES (
                %s, %s, %s, %s, TRUE, FALSE, TRUE, 'active', 'USDC', NOW(), NOW()
            )
            ON CONFLICT (owner_id)
            DO UPDATE SET
                owner_wallet = EXCLUDED.owner_wallet,
                display_name = EXCLUDED.display_name,
                email = EXCLUDED.email,
                email_verified = TRUE,
                notify_alerts = TRUE,
                updated_at = NOW()
            """,
            (
                owner_id,
                normalized_wallet,
                f"Transaction E2E {run_id}",
                normalized_email,
            ),
        )
    return owner_id, normalized_wallet


def _fixtures(run_id: str, owner_wallet: str, base_url: str) -> list[dict[str, Any]]:
    common = {
        "runId": run_id,
        "ownerAddress": owner_wallet,
        "wallet": owner_wallet,
        "network": "Arbitrum Sepolia",
        "actionUrl": f"{base_url.rstrip('/')}/dashboard",
    }
    return [
        {
            "templateKey": "deposit_confirmed",
            "eventType": "deposit.confirmed",
            "resourceType": "deposit",
            "resourceId": f"{run_id}-deposit-001",
            "title": "Deposit confirmed",
            "body": "Your staging deposit has been confirmed.",
            "payload": {
                **common,
                "depositId": f"{run_id}-deposit-001",
                "amount": "1.000000 USDC",
                "amountUsdc": "1.000000",
                "status": "CONFIRMED",
                "txHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
            },
        },
        {
            "templateKey": "refund_completed",
            "eventType": "refund.completed",
            "resourceType": "refund",
            "resourceId": f"{run_id}-refund-001",
            "title": "Refund completed",
            "body": "Your staging refund has been completed.",
            "payload": {
                **common,
                "refundId": f"{run_id}-refund-001",
                "amount": "0.500000 USDC",
                "amountUsdc": "0.500000",
                "status": "COMPLETED",
                "txHash": "0x2222222222222222222222222222222222222222222222222222222222222222",
            },
        },
        {
            "templateKey": "consumer_withdrawal_ticket_ready",
            "eventType": "consumer_withdrawal.ticket_ready",
            "resourceType": "withdrawal",
            "resourceId": f"{run_id}-consumer-withdrawal-001",
            "title": "Withdrawal ticket ready",
            "body": "Your consumer withdrawal ticket is ready to claim.",
            "payload": {
                **common,
                "withdrawalId": f"{run_id}-consumer-withdrawal-001",
                "amount": "0.250000 USDC",
                "amountUsdc": "0.250000",
                "status": "SIGNED",
            },
        },
        {
            "templateKey": "provider_withdrawal_rejected",
            "eventType": "provider_withdrawal.rejected",
            "resourceType": "provider_withdrawal",
            "resourceId": f"{run_id}-provider-withdrawal-rejected-001",
            "title": "Provider withdrawal rejected",
            "body": "Your provider withdrawal was rejected in staging.",
            "payload": {
                **common,
                "withdrawalId": f"{run_id}-provider-withdrawal-rejected-001",
                "amount": "0.750000 USDC",
                "amountUsdc": "0.750000",
                "status": "REJECTED",
                "reason": "E2E staging review fixture",
            },
        },
        {
            "templateKey": "provider_withdrawal_completed",
            "eventType": "provider_withdrawal.completed",
            "resourceType": "provider_withdrawal",
            "resourceId": f"{run_id}-provider-withdrawal-completed-001",
            "title": "Provider withdrawal completed",
            "body": "Your provider withdrawal has been completed.",
            "payload": {
                **common,
                "withdrawalId": f"{run_id}-provider-withdrawal-completed-001",
                "amount": "1.250000 USDC",
                "amountUsdc": "1.250000",
                "status": "COMPLETED",
                "txHash": "0x3333333333333333333333333333333333333333333333333333333333333333",
            },
        },
    ]


def _enqueue_in_app(storage: PostgresStorage, *, run_id: str, owner_wallet: str, fixture: dict[str, Any]) -> None:
    category_by_resource = {
        "deposit": "deposit",
        "refund": "refund",
        "withdrawal": "withdrawal",
        "provider_withdrawal": "withdrawal",
    }
    storage.enqueue_in_app_notification(
        InAppNotificationIntent(
            notification_id=f"txn-e2e-inapp-{run_id}-{fixture['templateKey']}",
            dedupe_key=f"txn-e2e:{run_id}:inapp:{fixture['eventType']}",
            recipient_type="owner",
            recipient_owner_id=owner_wallet,
            event_type=fixture["eventType"],
            category=category_by_resource.get(str(fixture["resourceType"]), "finance"),
            severity="success" if str(fixture["payload"].get("status", "")).upper() != "REJECTED" else "warning",
            priority="transactional_high",
            title=fixture["title"],
            body=fixture["body"],
            action_url=fixture["payload"].get("actionUrl"),
            resource_type=fixture["resourceType"],
            resource_id=fixture["resourceId"],
            payload=fixture["payload"],
        )
    )


async def _run() -> dict[str, Any]:
    env_name = os.getenv("TRANSACTION_NOTIFICATIONS_ENV", "local").strip().lower()
    run_id = _require_env("TRANSACTION_NOTIFICATIONS_RUN_ID")
    dsn = _require_env("TRANSACTION_NOTIFICATIONS_POSTGRES_DSN")
    email = os.getenv("TRANSACTION_NOTIFICATIONS_TEST_EMAIL", DEFAULT_LOCAL_EMAIL).strip().lower()
    owner_wallet = normalize_wallet(os.getenv("TRANSACTION_NOTIFICATIONS_OWNER_WALLET", DEFAULT_OWNER_WALLET))
    base_url = os.getenv(
        "PUBLIC_APP_BASE_URL",
        os.getenv("PUBLIC_GATEWAY_BASE_URL", "http://127.0.0.1:3000"),
    ).strip()
    drain_mode = os.getenv("TRANSACTION_NOTIFICATIONS_DRAIN_MODE", "fake").strip().lower()

    storage = PostgresStorage(dsn=dsn, ensure_schema=False, connect_timeout_sec=5, pool_max=2)
    owner_id, owner_wallet = _seed_verified_owner(
        storage,
        owner_wallet=owner_wallet,
        email=email,
        run_id=run_id,
    )

    lark_results: list[dict[str, Any]] = []
    email_enqueued: list[dict[str, Any]] = []
    in_app_enqueued: list[dict[str, Any]] = []
    fixtures = _fixtures(run_id, owner_wallet, base_url)

    for fixture in fixtures:
        _enqueue_in_app(storage, run_id=run_id, owner_wallet=owner_wallet, fixture=fixture)
        in_app_enqueued.append(
            {
                "eventType": fixture["eventType"],
                "resourceId": fixture["resourceId"],
            }
        )
        email_ok = enqueue_transaction_email(
            storage,
            owner_wallet=owner_wallet,
            template_key=fixture["templateKey"],
            event_type=fixture["eventType"],
            payload=fixture["payload"],
            require_verified_email=True,
        )
        email_enqueued.append(
            {
                "templateKey": fixture["templateKey"],
                "eventType": fixture["eventType"],
                "ok": bool(email_ok),
            }
        )
        lark_ok = await _send_lark_transaction_event(
            template_key=fixture["templateKey"],
            event_type=fixture["eventType"],
            owner_wallet=owner_wallet,
            payload=fixture["payload"],
        )
        lark_results.append(
            {
                "templateKey": fixture["templateKey"],
                "eventType": fixture["eventType"],
                "ok": bool(lark_ok),
            }
        )

    drain_stats: dict[str, Any] | None = None
    fake_email_sent: list[dict[str, Any]] = []
    if drain_mode == "fake":
        sender = FakeEmailSender(run_id)
        drain_stats = await drain_notification_outbox_once(
            storage,
            sender=sender,
            batch_size=20,
        )
        fake_email_sent = sender.sent
    elif drain_mode == "real":
        sender = GmailSmtpSender()
        aggregate = {
            "claimed": 0,
            "failed": 0,
            "quotaDeferred": 0,
            "sent": 0,
        }
        # Real SMTP can occasionally close a connection mid-batch. The outbox
        # contract is retry-safe, so the live local E2E exercises the retry path
        # instead of failing on one transient provider hiccup.
        for attempt in range(3):
            stats = await drain_notification_outbox_once(
                storage,
                sender=sender,
                batch_size=20,
                retry_base_sec=1,
            )
            for key in aggregate:
                aggregate[key] += int(stats.get(key, 0))
            if int(stats.get("failed", 0)) == 0:
                break
            if attempt < 2:
                await asyncio.sleep(1.2)
        drain_stats = aggregate

    receipt = render_notification_email("deposit_confirmed", fixtures[0]["payload"])
    return {
        "environment": env_name,
        "runId": run_id,
        "ownerId": owner_id,
        "ownerWallet": owner_wallet,
        "expectedTemplates": [fixture["templateKey"] for fixture in fixtures],
        "expectedEvents": [fixture["eventType"] for fixture in fixtures],
        "inAppEnqueued": in_app_enqueued,
        "emailEnqueued": email_enqueued,
        "larkResults": lark_results,
        "drainStats": drain_stats,
        "fakeEmailSent": fake_email_sent,
        "receiptSample": {
            "subject": receipt.subject,
            "actionUrl": fixtures[0]["payload"]["actionUrl"],
            "htmlContainsReceipt": "Receipt from Synapse Network" in receipt.html_body,
            "htmlContainsAmount": "1.000000" in receipt.html_body,
            "htmlContainsStatus": "CONFIRMED" in receipt.html_body,
            "htmlContainsReference": f"{run_id}-deposit-001" in receipt.html_body,
            "htmlContainsCta": "Open Synapse" in receipt.html_body,
        },
    }


def main() -> int:
    try:
        result = asyncio.run(_run())
    except Exception as exc:
        print(
            _json_dump(
                {
                    "status": "failed",
                    "error": str(exc),
                }
            )
        )
        return 1
    print(_json_dump({"status": "success", **result}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
