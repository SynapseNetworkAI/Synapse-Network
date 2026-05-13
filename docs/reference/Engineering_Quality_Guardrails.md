# Engineering Quality Guardrails

- Status: canonical
- Code paths: `scripts/ci/quality_budget_check.mjs`, `.github/instructions/*.instructions.md`, `.github/pull_request_template.md`
- Verified with: `npm run ci:quality-budget`, `npm run ci:docs`
- Last verified against code: 2026-05-14

This page is the shared quality-budget rulebook for Synapse-Network. It exists
to prevent complexity before code is written and to explain what the CI hard
gate is enforcing.

## Current Budgets

The canonical hard gate is `npm run ci:quality-budget`.

| Budget                                   | Limit                 |
| ---------------------------------------- | --------------------- |
| New runtime source file                  | `500` effective lines |
| New test-like file                       | `800` effective lines |
| JavaScript / TypeScript runtime function | `120` effective lines |
| Python runtime function                  | `80` effective lines  |
| Nesting depth                            | `4`                   |
| Estimated function complexity            | `12`                  |
| Function parameters                      | `8`                   |

Effective lines ignore blank and comment-only lines. Legacy oversized files are
tracked through the explicit baseline ledger in
`scripts/ci/quality_budget_check.mjs`; that ledger is a stop-loss, not a target.

## Refactoring Policy

When a file or function is approaching the budget, first ask what responsibility
is actually too large.

- If one function is too long, extract private helpers with names that describe
  sub-decisions, transformations, validation, or serialization.
- If a file mixes independent responsibilities, split around a clear boundary
  such as `scanner`, `runner`, `serializer`, `adapter`, `client`, or `policy`.
- If a module is public, preserve the old import path with a small re-export or
  compatibility wrapper when callers still depend on it.
- Do not create meaningless one-function shards only to pass the line-count
  gate. A split is valid only when it makes ownership, testing, or review easier.

Good splits reduce cognitive load. Bad splits hide the same complexity across
more files.

## PR Expectations

If a change touches a quality boundary, the PR description must say:

1. Which budget was at risk or exceeded.
2. Why the code was split.
3. Where the responsibility moved.
4. Which focused tests prove the split preserved behavior.

If the only reason for a new module is "to pass CI", rework the split until the
module has a real responsibility.

## Validation

Use the narrowest relevant gate first:

```bash
npm run ci:quality-budget
npm run ci:docs
npm run ci:format-check
git diff --check
```

For CI or instruction-routing changes, also check:

```bash
node --test scripts/ci/quality_budget_check.test.mjs
node -e "JSON.parse(require('fs').readFileSync('docs/reference/Agent_Task_Map.json', 'utf8'))"
```

Do not introduce a new formatter or complexity tool without a separate design
decision. The current quality gate is the repo source of truth.
