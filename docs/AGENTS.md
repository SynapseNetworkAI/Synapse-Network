# Synapse Canonical Rules

This file is the canonical workspace-level rule source for Synapse Network.

## 1. North Star

- Synapse is the settlement layer for AI agents.
- Product decisions must optimize for `Agent completed first paid invocation autonomously.`
- Human UX is support infrastructure for owner authorization, funding, budgeting, and observability. The runtime first-class user is still the agent.

## 2. Architecture Invariants

1. Smart contracts stay dumb. Keep high-frequency budget and routing logic off-chain.
2. Gateway is the fast centralized control point for routing, charging, balance checks, and risk enforcement.
3. Runtime identity is agent-first, not API-key-bucket-first.
4. USDC is the single settlement currency.
5. Agent-facing discover, quote, and invoke surfaces expose services, not provider settlement internals.

## 3. Security and Finance Baseline

- Default deny for privileged surfaces.
- Bind sensitive ownership and actor identity to server-side trust, not raw client input.
- Treat money movement and settlement paths as transaction-sensitive and audit-sensitive.
- Preserve idempotency, consistency, append-only auditability, and minimal error disclosure.
- Prefer correctness and traceability over convenience whenever finance and speed conflict.
- Money crosses boundaries as string, computes as `Decimal`, and stores as `NUMERIC(36, 6)`.

## 4. Instruction Layering

The workspace should now be split into three layers instead of putting every rule into one AGENTS file.

AI-readable repository entrypoints now also include:

- root `llms.txt` for the shortest machine-readable repo map
- `docs/ARCHITECTURE.md` for the top-level system model
- `docs/00_Governance/exec-plans/` for persistent multi-step execution plans

### 4.1 Canonical Workspace Layer

- `docs/AGENTS.md`
- Purpose: product doctrine, architecture invariants, security baseline, docs-sync policy, and instruction layout.

### 4.2 File-Type Instruction Layer

- `.github/instructions/python.instructions.md`
- `.github/instructions/frontend.instructions.md`
- `.github/instructions/finance-backend.instructions.md`
- `.github/instructions/finance-admin.instructions.md`
- `.github/instructions/admin-console.instructions.md`
- `.github/instructions/docs-sync.instructions.md`
- `.github/instructions/safety-guard.instructions.md`
- `.github/instructions/README.md`
- Purpose: language and framework rules plus the routing manifest for agents that do not auto-attach `.github/instructions` by file type.
- These files should carry coding style, layering, framework conventions, version baselines, and test expectations.
- Not every agent automatically reads `.github/instructions`; Codex, Cursor, Claude, Gemini, and Copilot must enter through their bridge files and then route here.

Recommended split:

- `python.instructions.md`: general Python and FastAPI coding rules
- `frontend.instructions.md`: shared React and Next frontend rules
- `finance-backend.instructions.md`: transaction-sensitive money and ledger rules
- `finance-admin.instructions.md`: `gateway-admin` finance review, approval, withdraw-review, refund, and reconciliation control-plane rules
- `admin-console.instructions.md`: admin-front list, pagination, state, and ops UI rules
- `docs-sync.instructions.md`: behavior-change sync rules for code, tests, docs, and instructions
- `safety-guard.instructions.md`: pre-flight safety checklist and blocked-patterns gate for production deployments, migrations, destructive DB ops, and irreversible operations

### 4.3 Agent Bridge Layer

Bridge entrypoints:

- Codex: root `AGENTS.md`
- Cursor: `.cursor/rules/synapse-instructions.mdc`
- Claude: `CLAUDE.md`
- Gemini: `GEMINI.md`
- Copilot: `.github/copilot-instructions.md`

Keep those bridge files thin. They should point to `llms.txt`, `docs/AGENTS.md`, `.github/instructions/README.md`, and the matching task-specific instruction files instead of duplicating rules.

### 4.4 Subproject Local Layer

- `services/user-front/AGENTS.md`
- `services/admin-front/AGENTS.md`
- `services/gateway-admin/AGENTS.md`
- `provider_service/AGENTS.md`
- Purpose: local role boundaries, package-manager rules, runtime commands, validation entrypoints, and project-specific exceptions.

## 5. What Belongs Where

### Put in `.instructions.md`

- Python version baseline and backend layering rules.
- FastAPI, repository, Pydantic, transaction, test, and docs-sync coding norms.
- React, Next.js, TypeScript, component reuse, visual consistency, and frontend testing norms.
- Cross-project language conventions that repeat across multiple codebases.

### Keep in `docs/AGENTS.md`

- Business vision and product doctrine.
- Security and finance guardrails.
- System-wide architectural constraints.
- Documentation governance and rule-source hierarchy.

### Keep in subproject `AGENTS.md`

- What this project is and is not responsible for.
- Local interpreter, package manager, and run commands.
- Project-specific product docs that must be read before edits.
- Local stop conditions and exceptions that do not apply workspace-wide.

## 6. Execution Workflow

Before implementation:

1. Read `docs/AGENTS.md`.
2. For cross-project or repo-structure tasks, read `docs/ARCHITECTURE.md` and root `llms.txt`.
3. If the task touches `docs/` structure or canonical entrypoints, read `docs/00_Governance/Documentation_Constraints.md`.
4. If the task touches visual or UX work, read `docs/Design.md`.
5. Rely on `.github/instructions/*.instructions.md` for language-specific coding rules.
6. Read the target subproject `AGENTS.md` for local commands, runtime boundaries, and validation flow.
7. If the task is finance-sensitive, admin-console-heavy, or behavior-changing across docs/tests/contracts, expect the finer-grained instructions to apply too.

## 6.1 Engineering Quality Budgets

- New runtime files should stay below `500` effective lines. New test-like files should stay below `800` effective lines.
- Runtime functions should stay below the repo quality gate budgets: JavaScript/TypeScript `120` effective lines and Python `80` effective lines.
- Split complex logic into private helpers first. Split modules only when the new boundary has a clear responsibility such as scanner, runner, serializer, adapter, client, or policy.
- Do not create meaningless tiny files only to pass a line-count gate. The split must make ownership and review easier.
- For quality-budget, file-size, function-length, PR template, or CI gate work, load `docs/reference/Engineering_Quality_Guardrails.md` through `docs/reference/Agent_Task_Map.*`.

## 7. Docs-Code-Test Sync

- Any observable behavior change must update the matching docs.
- Backend behavior changes must update tests in the same change.
- Frontend information architecture, wording, and API expectations must stay aligned with the canonical docs.
- Do not leave stale rules duplicated across root and subproject AGENTS files.
- If a task changes `docs/` structure, indexes, or governance rules, it must pass `npm run ci:docs` before closing.

## 8. Design Rule for Future Customization

If a rule is repeating across multiple Python services or multiple frontend apps, move it into `.github/instructions/` instead of copying it into every AGENTS file.

If a rule only matters to one service's role, environment, or runtime workflow, keep it in that service's `AGENTS.md`.

## 9. Developer Tools (`scripts/tools/`)

Reusable scripts live in `scripts/tools/`. See `scripts/tools/README.md` for full docs.

| Tool                     | Purpose                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `screenshot_docs.js`     | Take EN + ZH Playwright screenshots of any docs page to verify i18n rendering |
| `audit_i18n_comments.js` | Scan docs pages for hardcoded CJK `//` comments that need i18n extraction     |

### agent-browser — AI Browser Automation CLI

[`agent-browser`](https://github.com/vercel-labs/agent-browser) (v0.25.3, 27.8k★) is a Rust-native CLI that gives AI agents full browser control via Chrome for Testing. Use it for UI verification, screenshot capture, and autonomous browser workflows.

**One-time setup (macOS ARM64):**

```bash
npm install -g agent-browser   # install CLI
agent-browser install          # download Chrome for Testing (~165 MB)
# Chrome lands at ~/.agent-browser/browsers/chrome-147.x/
```

> If npm fails with `ECONNREFUSED 127.0.0.1:7890`, unset the stale proxy first:
>
> ```bash
> unset HTTP_PROXY HTTPS_PROXY ALL_PROXY && npm install -g agent-browser
> ```

**Core workflow:**

```bash
agent-browser open <url>          # launch browser and navigate
agent-browser snapshot -i         # print interactive element refs
agent-browser click @e1           # click element by ref
agent-browser fill @e2 "text"     # type into input
agent-browser screenshot out.png  # capture current viewport
```

**Verify the frontend renders correctly:**

```bash
agent-browser open http://localhost:3000
agent-browser screenshot /tmp/user-front.png
```

### i18n Code Block Comment Rule

**Do not hardcode CJK or language-specific text inside CodeBlock `code` props.**

Use the array-join pattern instead:

```tsx
const cAuth = tList("docsPage.consumerCodeAuth"); // string[]

<CodeBlock
  lang="typescript"
  code={[`// ${cAuth[0]}`, `const { challenge } = await fetch(...)`].join("\n")}
/>;
```

Add corresponding arrays to both `en/docsPage.ts`, `zh/docsPage.ts`, and `schema.ts`.

Run `node scripts/tools/audit_i18n_comments.js` to validate before merging any docs page changes.

## 10. Directory Structure & Script Sync Rule

### Canonical service layout

```
services/
  gateway/          # Python FastAPI gateway (main backend)
  gateway-admin/    # Admin control-plane gateway
  user-front/       # Consumer-facing Next.js frontend
  admin-front/      # Admin-facing Next.js frontend

scripts/ → tools/scripts/   # symlink — see "symlink note" below
  local/            # Local dev lifecycle (setup/stop/restart)
  ci/               # CI quality gates per service
  chain/            # Hardhat/Anvil scripts (deploy, fund, e2e)
  prod/             # Production start/stop
  staging/          # Staging start/stop
  python/           # Python resolver helpers

../Synapse-Network-Provider/   # Separate sibling repo for provider_service
../Synapse-Network-Sdk/        # Separate sibling repo for SDK
```

### Symlink note — always use `../..` from `scripts/local/` or `scripts/ci/`

`scripts/` is a **symlink** pointing to `tools/scripts/`. Bash `cd` traverses it
logically, so `pwd` reports the logical path (e.g. `Synapse-Network/scripts/local`).

This means:

- `SCRIPT_DIR/../../..` → **parent of repo root** (wrong)
- `SCRIPT_DIR/../..` → **repo root** ✓

Every shell script under `scripts/` must use exactly **two levels up** (`../..`) to
reach `ROOT_DIR`, regardless of how deep the subdirectory is under `scripts/`.

### Mandatory checklist when renaming or moving directories

When any of the following changes:

- A directory under `services/` is renamed or moved
- A sibling repo path changes (e.g. `Synapse-Network-Provider/`)
- The `scripts/` symlink target changes

Run this audit before committing:

```bash
# 1. Check all scripts reference correct paths
grep -rn "apps/\|/provider_service\b" scripts/ --include="*.sh" --include="*.py"

# 2. Check ROOT_DIR depth is always ../.. from scripts/*/ dirs
grep -rn "\.\./\.\./\.\." scripts/ --include="*.sh"
# → must return nothing (any result is a bug)

# 3. Syntax-check all scripts
find scripts/ -name "*.sh" | xargs -I{} bash -n {}

# 4. Run full local setup to confirm
sh scripts/local/setup_local_env.sh
```

Stale paths must be fixed in the **same commit** as the directory change.
