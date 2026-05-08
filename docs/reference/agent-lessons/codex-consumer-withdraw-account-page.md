# Agent Lessons: codex-consumer-withdraw-account-page

Task: Split Consumer withdraw into Account and keep withdrawal UX business-safe.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Branch renames need matching PR lessons files

- Domain: ci
- Severity: warning
- Trigger: The original feature branch was already tied to a merged PR, so the work was pushed on a new branch, but CI looked for the new branch-specific lessons file.
- Root cause: The publish flow reused the previous branch lesson file after creating `codex/consumer-withdraw-account-page`.
- Fix: Add a lessons file for the new branch slug and keep the existing lesson record reviewable.
- Rule: Whenever a PR is moved to a new branch, create or copy the branch-specific `docs/reference/agent-lessons/<branch-slug>.md` before pushing.
- Upgrade: agents-memory

### Lesson: User-facing status copy changes need matching DOM expectations

- Domain: test
- Severity: warning
- Trigger: PR CI failed because an admin-front test still expected a reviewer message containing raw `REQUESTED` status after the UI copy was changed to a business-safe syncing message.
- Root cause: The implementation removed raw status copy from the UI but missed the focused hook test that asserted the old exact string.
- Fix: Update the test expectation to the same user-facing message produced by `review-action-feedback`.
- Rule: When changing finance/admin status copy, search focused DOM and hook tests for the old exact string before pushing.
- Upgrade: agents-memory

### Lesson: Forwarded input refs should use React Ref types through component boundaries

- Domain: frontend
- Severity: warning
- Trigger: GitHub CI reached the user-front production build and failed on a `RefObject<HTMLInputElement | null>` passed through to a forwarded input component.
- Root cause: The prop type was narrower than the `forwardRef` target expected by `XInput`, while local focused tests did not run Next production type checking.
- Fix: Type the intermediary prop as `Ref<HTMLInputElement>` so it can safely carry the `useRef` value into the forwarded input.
- Rule: For props that are only forwarded into a `forwardRef` component, use `Ref<T>` rather than hand-rolled nullable `RefObject<T | null>`.
- Upgrade: agents-memory
