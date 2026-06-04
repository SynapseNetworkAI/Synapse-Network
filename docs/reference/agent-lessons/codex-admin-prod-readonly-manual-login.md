### Lesson: Use manual MFA handoff for prod admin E2E

- Domain: e2e
- Severity: high
- Trigger: Prod admin-front readonly E2E could only run with `ADMIN_SESSION_TOKEN` or password plus OTP, leaving MFA-enabled production verification blocked when no safe token handoff was available.
- Root cause: The harness had no operator-mediated MFA path, so agents were tempted to look for cookies, browser profile state, or database sessions.
- Fix: Add an explicit manual-login mode to the prod readonly E2E harness so an operator can complete MFA in a Playwright browser context and the script can continue with automated route, API, screenshot, and log verification.
- Rule: Do not bypass production admin authentication by reading browser profiles, cookies, local storage, or database session state; use token handoff, credentials plus OTP, or an explicit manual-login harness path.
- Upgrade: agent-lessons
