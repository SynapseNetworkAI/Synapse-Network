# Agent Lessons: codex-user-front-copyable-identifiers-e2e

Task: Add User-front copyable identifier DOM evidence.
Status: Active

## Push Review

### Lesson: User-front DOM route fixtures need local-origin tolerance

- Domain: frontend-e2e
- Severity: warning
- Trigger: The copyable identifier E2E initially showed empty Billing rows even though the fixture data was correct.
- Root cause: The app served from `127.0.0.1` still called Gateway or RPC URLs through another local origin variant such as `localhost`, so the Playwright route fixture missed those requests.
- Fix: Intercept local Gateway and RPC traffic by port and JSON-RPC payload shape, not only by one exact base URL string.
- Rule: Local DOM E2E fixtures for User-front should tolerate `localhost` and `127.0.0.1` origin variants.
- Upgrade: pr-lessons-only

### Lesson: Assert actual route behavior before naming page evidence

- Domain: frontend-e2e
- Severity: warning
- Trigger: The E2E expected `/provider/settlements` to render a distinct settlement table.
- Root cause: The route currently redirects to `/provider/withdraw`, where the withdrawal history copy controls live.
- Fix: Treat `/provider/settlements` as a settlements alias and validate the redirected withdrawal history copy controls.
- Rule: Before adding DOM evidence for a route, verify whether the route renders directly or redirects to another product surface.
- Upgrade: pr-lessons-only
