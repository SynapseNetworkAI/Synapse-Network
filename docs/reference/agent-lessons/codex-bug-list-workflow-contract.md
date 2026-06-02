### Lesson: Route real bugs through Bug List before fixing

- Domain: workflow
- Severity: medium
- Trigger: product bugs and regressions could be fixed directly without Bug List intake, claim, fix evidence, verification, and closure.
- Root cause: repo-level agent instructions did not explicitly route real defects through the workspace Bug List skill or MCP workflow.
- Fix: document the Bug List workflow contract in the repo AGENTS entrypoint and point API/tool details to the canonical Growing skill.
- Rule: when a task is a real product defect, intake or dedupe it, claim before fixing, link the branch, commit, or PR, add verification, and close only with complete evidence.
- Upgrade: docs/reference/agent-lessons
