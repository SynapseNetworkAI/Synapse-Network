from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import Protocol

from src.core.config import settings

from .models import EmailFromMissing, EmailSendResult, GmailCredentialsMissing, RenderedEmail


class EmailSender(Protocol):
    def send(self, *, recipient_email: str, rendered: RenderedEmail) -> EmailSendResult:
        ...


class GmailSmtpSender:
    """Gmail SMTP sender used only by the notification worker.

    Gateway request handlers must enqueue outbox rows and must never instantiate
    this class directly. Email delivery is an at-least-once side effect.
    """

    def __init__(
        self,
        *,
        host: str | None = None,
        port: int | None = None,
        username: str | None = None,
        app_password: str | None = None,
        from_address: str | None = None,
        reply_to: str | None = None,
        timeout_sec: float | None = None,
    ) -> None:
        self._host = host or settings.gmail_smtp_host
        self._port = int(port or settings.gmail_smtp_port)
        self._username = username if username is not None else settings.gmail_smtp_username
        self._app_password = (
            app_password if app_password is not None else settings.gmail_smtp_app_password
        )
        self._from_address = from_address if from_address is not None else settings.email_from
        self._reply_to = reply_to if reply_to is not None else settings.email_reply_to
        self._timeout_sec = float(timeout_sec or settings.email_send_timeout_sec)

    def _build_message(self, *, recipient_email: str, rendered: RenderedEmail) -> EmailMessage:
        if not self._from_address:
            raise EmailFromMissing
        message = EmailMessage()
        message["Subject"] = rendered.subject
        message["From"] = self._from_address
        message["To"] = recipient_email
        if self._reply_to:
            message["Reply-To"] = self._reply_to
        message.set_content(rendered.text_body)
        message.add_alternative(rendered.html_body, subtype="html")
        return message

    def send(self, *, recipient_email: str, rendered: RenderedEmail) -> EmailSendResult:
        if not self._username or not self._app_password:
            raise GmailCredentialsMissing
        message = self._build_message(recipient_email=recipient_email, rendered=rendered)
        with smtplib.SMTP(self._host, self._port, timeout=self._timeout_sec) as smtp:
            smtp.starttls()
            smtp.login(self._username, self._app_password)
            response = smtp.send_message(message)
        return EmailSendResult(
            message_id=message.get("Message-ID"),
            provider_response={
                "transport": "gmail_smtp",
                "accepted": not bool(response),
                "rejectedRecipients": sorted(str(key) for key in response),
            },
        )
