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

### Lesson: Branch handoff must include untracked files in the final clean check

- Domain: git-hygiene
- Severity: warning
- Trigger: After the docs artifact PR was pushed, `git switch main` revealed an unrelated untracked workflow file that would have stayed behind even though tracked files were clean.
- Root cause: The publish flow checked tracked diffs and branch switching, but did not treat `git status --short --untracked-files=all` as the final no-leftovers gate.
- Fix: Include the untracked staging jobs workflow in the PR scope and make final handoff status include untracked files explicitly.
- Rule: Before declaring a branch clean, run `git status --short --untracked-files=all`; do not rely on tracked diffs alone.
- Upgrade: git-hygiene
