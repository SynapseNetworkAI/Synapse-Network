# Agent Lessons: codex-submit-root-worktree-all

Task: Submit pending root worktree changes.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Optional project shards must check dependency files before setup

- Domain: ci
- Severity: warning
- Trigger: Full PR CI selected `sdk_python_checks` in a repository checkout that does not contain `sdk/python/requirements.txt` or `sdk/python/pyproject.toml`.
- Root cause: The workflow started the `sdk-python` job from command scope alone, so `actions/setup-python` failed while resolving a pip cache path for an optional project directory.
- Fix: Gate the `sdk-python` job on both the requested command and the presence of the SDK Python dependency files.
- Rule: Optional CI shards must verify their project directory or dependency manifest exists before invoking language setup/cache actions.
- Upgrade: pr-lessons-only
