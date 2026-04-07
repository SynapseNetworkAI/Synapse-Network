---
created_at: 2026-04-07
updated_at: 2026-04-07
doc_status: active
---

# Task Graph

## Work Items

1. 基础设施或模板改动
2. 核心代码改动
3. 测试改动
4. 文档改动
5. 收尾清理

## Dependencies

- 哪些任务必须先完成？
- 哪些任务可以并行？

## Exit Criteria

- 任务完成时必须满足哪些条件？

## Onboarding Task Steps
```json
[
  {
    "group": "Integration",
    "priority": "required",
    "key": "mcp_config",
    "status": "WARN",
    "detail": "agents-memory exists but args do not include /Users/cliff/workspace/agent/Agents-Memory/scripts/mcp_server.py",
    "action": "Create or repair the MCP configuration so IDE agents can call Agents-Memory tools.",
    "command": "amem mcp-setup .",
    "verify_with": "amem doctor .",
    "done_when": "`amem doctor .` shows `[OK] mcp_config`.",
    "safe_to_auto_execute": true,
    "approval_required": false,
    "approval_reason": "writes only local IDE MCP config under .vscode for the current project",
    "next_command": "amem doctor ."
  }
]
```
