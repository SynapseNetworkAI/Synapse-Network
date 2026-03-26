---
description: >
  Agents-Memory bridge. Apply to every code-changing session.
  Loads shared error memory at session start; records new errors at session end.
  Works across all projects registered in the Agents-Memory system.
applyTo: "**"
---

# Agents-Memory Bridge

## Session Protocol

### On Session Start (every coding session)

**Step 1 — Load hot-tier index (always):**
```
Read /Users/cliff/workspace/Agents-Memory/index.md
```
This file is ≤ 400 tokens. It tells you:
- How many error records exist (determines search strategy)
- Which error categories have been seen most
- Which rules have been promoted to instruction files

**Step 2 — Load domain rules (before touching domain-specific code):**
```
# Finance code
Read /Users/cliff/workspace/Agents-Memory/memory/rules.md (Finance section)

# Python / FastAPI
Read /Users/cliff/workspace/Agents-Memory/memory/rules.md (Python section)

# TypeScript / Frontend
Read /Users/cliff/workspace/Agents-Memory/memory/rules.md (TypeScript section)
```

**Step 3 — Search before writing (when you see a pattern):**
```bash
python3 /Users/cliff/workspace/Agents-Memory/scripts/memory.py search <keyword>
```
Or via MCP tool: `memory_search(query="<keyword>")`

---

### On Session End (after any bug fix or unexpected behavior)

**Record any error that took more than one attempt to fix:**

**Option A — MCP tool (preferred, works inside agent tool calls):**
```
memory_record_error(
  project="synapse-network",     # or spec2flow, gateway, etc.
  domain="python",               # finance | frontend | python | docs | config | infra
  category="logic-error",        # see CATEGORIES in memory.py
  severity="warning",            # critical | warning | info
  task="What were you doing",
  error_desc="What went wrong",
  root_cause="Why it happened",
  fix="How it was fixed",
  rule="Never do X, always do Y instead."
)
```

**Option B — CLI (when MCP not available):**
```bash
python3 /Users/cliff/workspace/Agents-Memory/scripts/memory.py new
```

---

## Trigger Conditions

| Condition | Action |
|-----------|--------|
| Session starts with code changes | Load `index.md` |
| Working on finance/payment code | Also load `rules.md` Finance section |
| Working on Python/FastAPI | Also load `rules.md` Python section |
| Fixed a bug (any kind) | Record via MCP or CLI |
| Same error seen twice | Increment `repeat_count` via `memory_increment_repeat(id)` |
| Record reaches repeat_count ≥ 2 | Promote to instruction file via `memory_promote(id)` |

---

## Error Category Quick Reference

| Category | When to use |
|----------|-------------|
| `type-error` | TypeScript narrowing, Python type annotation failure |
| `logic-error` | Wrong algorithm, edge case missed |
| `finance-safety` | Precision loss, missing audit trail, wrong Decimal usage |
| `arch-violation` | Bypassed layering, wrong service access pattern |
| `test-failure` | Test infrastructure broke, coverage gap |
| `docs-drift` | Code changed but docs not updated |
| `config-error` | DSN, env var, secret misconfiguration |
| `build-error` | Import failure, compilation error |
| `runtime-error` | Unexpected exception, unhandled case |
| `security` | Any access control, injection, or SSRF risk |

---

## MCP Server

If the Agents-Memory MCP server is running as a VS Code tool, you can call:
- `memory_get_index()` — get index.md content
- `memory_get_rules(domain)` — get domain rules
- `memory_search(query)` — search errors
- `memory_record_error(...)` — record a new error
- `memory_increment_repeat(id)` — bump repeat count
- `memory_list_projects()` — see all registered projects
- `memory_sync_stats()` — check record count and search strategy

MCP server config: `/Users/cliff/workspace/Agents-Memory/.vscode/mcp.json`
