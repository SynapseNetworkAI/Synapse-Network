# Agent Lessons: codex-docs-front-generated-artifact-constraint

Task: Make docs-front generated API artifacts safe to commit, regenerate, and hand off without blocking branch switches.
Status: Active

## Push Review

### Lesson: Generated docs artifacts must satisfy the same formatter gate as hand-written files

- Domain: docs-front
- Severity: warning
- Trigger: `yarn build` regenerated `public/openapi.json` and `src/data/api-reference.json`, leaving dirty files that blocked `git switch main`; the first PR attempt then failed `ci:format-check` because generator output did not match Prettier.
- Root cause: The OpenAPI generator wrote raw `JSON.stringify(..., 2)` output while the repo format gate checks generated JSON with Prettier.
- Fix: Format generated OpenAPI and API reference JSON through Prettier inside the generator, track the generated files, and document that regenerated artifacts must be committed or restored before branch handoff.
- Rule: Any tracked generated docs artifact must be deterministic and format-gate compatible at the generator boundary, not fixed manually after each build.
- Upgrade: docs-front
