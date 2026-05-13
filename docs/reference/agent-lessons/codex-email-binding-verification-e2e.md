# Agent Lessons: codex-email-binding-verification-e2e

Task: Fix email verification resend behavior and local Gmail SMTP email-binding E2E evidence.
Status: Active

## Push Review

- Captured the async delivery evidence race fixed in this push.

## Lessons

### Lesson: Email delivery evidence must wait for async notification workers

- Domain: e2e
- Severity: warning
- Trigger: Local email-binding dogfood sent Gmail SMTP messages successfully, but the E2E checked `synapse_notification_delivery_log` before the async notification worker had persisted delivery evidence.
- Root cause: The script ran the local outbox worker and immediately queried the delivery log once, even though delivery logging can be completed by a background worker shortly after the API/UI step.
- Fix: Add a bounded polling helper for email delivery evidence before failing the dogfood step.
- Rule: E2E checks for async notification/outbox side effects must poll for durable evidence with a timeout instead of doing a single immediate read.
- Upgrade: pr-lessons
