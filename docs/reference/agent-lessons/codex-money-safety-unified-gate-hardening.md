### Lesson: Unified local gates must treat optional local fixtures as explicit skips, not hard failures

The money-safety unified runner initially failed when `LLM_E2E_CREDENTIAL` was absent locally, even though the local plan allows the LLM settlement lane to be skipped when no local fixture is configured. Future unified gates should encode optional local fixture policy directly in the runner and evidence contract so missing local-only fixtures do not mask real money-path regressions.

### Lesson: Long-running local E2E lanes need one canonical provider owner key and enough synthetic budget to cover every scenario

`withdrawal-one-ticket-evidence` drifted because its default provider key did not match local Provider onboarding ownership, and later because its synthetic receivable/call/credit budget was too small for the full provider scenario set. For future local fullchain lanes, bind the E2E wallet to the same canonical onboarding owner and size credential, QPS, and receivable generation loops to the full scenario matrix up front.
