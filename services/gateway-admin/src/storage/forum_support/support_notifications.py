from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from src.core.config import get_settings


def _public_app_url(path: str) -> str:
    base = get_settings().public_app_base_url.strip().rstrip("/")
    route = f"/{str(path or '').lstrip('/')}"
    return f"{base}{route}" if base else route


def enqueue_support_reply_notifications(
    cur: Any,
    *,
    topic_id: str,
    reply_id: str,
    task_id: str,
    author_address: str,
    topic_title: str,
    body: str,
    metadata: dict[str, Any],
) -> None:
    if not author_address or author_address == "anonymous":
        return
    cur.execute(
        """
        SELECT owner_wallet, email, email_verified
        FROM synapse_owner_accounts
        WHERE lower(owner_wallet) = lower(%s)
          AND status = 'active'
        LIMIT 1
        """,
        (author_address,),
    )
    owner = cur.fetchone()
    if not owner:
        return
    owner_wallet = str(owner["owner_wallet"]).lower()
    action_url = _public_app_url(f"/forum/{topic_id}")
    payload = {
        "topicId": topic_id,
        "replyId": reply_id,
        "responseTaskId": task_id,
        "feedbackId": metadata.get("feedbackId"),
        "supportCategory": metadata.get("supportCategory"),
        "title": topic_title,
        "messagePreview": body[:500],
        "actionUrl": action_url,
    }
    cur.execute(
        """
        INSERT INTO synapse_in_app_notifications (
            notification_id, dedupe_key, recipient_type, recipient_owner_id, recipient_admin_id,
            event_type, category, severity, priority, title, body, action_url,
            resource_type, resource_id, payload, created_at
        ) VALUES (
            %s, %s, 'owner', %s, NULL, 'support.reply_sent', 'system', 'info',
            'transactional', %s, %s, %s, 'support_case', %s, %s::jsonb, NOW()
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        """,
        (
            f"inapp-support-reply-{reply_id}",
            f"inapp:support.reply_sent:{owner_wallet}:{reply_id}",
            owner_wallet,
            "Synapse support replied",
            body[:240],
            action_url,
            task_id,
            Jsonb(payload),
        ),
    )
    email = str(owner.get("email") or "").strip().lower()
    if not email or not bool(owner.get("email_verified")):
        return
    cur.execute(
        """
        INSERT INTO synapse_notification_outbox (
            notification_id, dedupe_key, event_type, recipient_email, recipient_owner_id,
            priority, template_key, template_version, payload, status, attempt_count,
            next_attempt_at, created_at, updated_at
        ) VALUES (
            %s, %s, 'support.reply_sent', lower(%s), %s, 'transactional',
            'support_reply', 'v1', %s::jsonb, 'pending', 0, NOW(), NOW(), NOW()
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        """,
        (
            f"email-support-reply-{reply_id}",
            f"email:support.reply_sent:{owner_wallet}:{reply_id}",
            email,
            owner_wallet,
            Jsonb(payload),
        ),
    )
