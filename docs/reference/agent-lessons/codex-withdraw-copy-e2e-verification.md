# Agent Lessons: codex-withdraw-copy-e2e-verification

Task: Add withdrawal user-facing error copy DOM and browser screenshot verification.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Browser error-copy gates must scan the whole user-facing DOM

- Domain: frontend
- Severity: warning
- Trigger: Withdrawal error-copy screenshots initially only waited for the expected toast text, so unrelated page copy could still leak internal terms such as backend, ticket, request ID, or raw error codes.
- Root cause: The browser regression checked success presence without a strict forbidden-string sweep over the rendered body.
- Fix: Extend the Playwright error-toast runner with broader forbidden raw strings, withdrawal history rows, notification cases, and EN/ZH screenshots.
- Rule: User-facing money-flow error gates must prove both that the friendly copy appears and that internal implementation terms are absent from the rendered DOM.
- Upgrade: agents-memory
