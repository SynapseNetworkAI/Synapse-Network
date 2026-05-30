### Lesson: Treat intentionally removed cloud resources as pass in audits

- Domain: ops
- Severity: medium
- Trigger: after deleting the prod Serverless VPC Access connector, the gross cost audit still warned because it collapsed all `gcloud describe` failures into a generic unreadable state.
- Root cause: the audit helper discarded stderr, so it could not distinguish the desired `NOT_FOUND` state from IAM, API, or transient read failures.
- Fix: preserve the connector describe error text and classify `NOT_FOUND` as the expected pass state while keeping other read failures as warnings.
- Rule: cost cleanup audits must encode the desired post-cleanup absence state explicitly instead of treating every missing resource as an access failure.
- Upgrade: docs/reference/agent-lessons
