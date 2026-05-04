# AI Instruction Entrypoints

Synapse uses one shared instruction stack with thin bridge files for each agent. The bridge files exist because Codex, Cursor, Claude, Gemini, and Copilot do not all discover `.github/instructions` the same way.

## Entrypoints

| Agent   | Entrypoint                               | Purpose                                                              |
| ------- | ---------------------------------------- | -------------------------------------------------------------------- |
| Codex   | `AGENTS.md`                              | Main repository execution mirror and startup contract.               |
| Cursor  | `.cursor/rules/synapse-instructions.mdc` | Always-on Cursor rule that routes into the shared instruction stack. |
| Claude  | `CLAUDE.md`                              | Thin Claude bridge for read order and instruction routing.           |
| Gemini  | `GEMINI.md`                              | Thin Gemini bridge for read order and instruction routing.           |
| Copilot | `.github/copilot-instructions.md`        | GitHub Copilot custom instructions plus shared routing.              |

## Shared Source Of Truth

- `llms.txt` is the shortest machine-readable repository map.
- `docs/AGENTS.md` is the canonical workspace rule source.
- `.github/instructions/README.md` is the routing manifest for task-specific instruction files.
- `.github/instructions/*.instructions.md` contains the detailed language, finance, docs-sync, admin-console, and safety rules.
- `Codex_Token_Optimization.md` is the operating policy for high-frequency Codex memory, context routing, handoffs, search boundaries, and reasoning-effort selection.

## Drift Rule

Do not copy detailed rules into the bridge files. If a rule changes, update the canonical instruction file and keep every bridge pointing to the same manifest.

Run `npm run ci:docs` after changing any bridge or instruction entrypoint. The docs gate checks that the bridge files exist, reference the shared stack, and that `.github/instructions/README.md` covers every `*.instructions.md` file.

## Token Hygiene Rule

Do not expand bridge files with long operational guidance. Keep `AGENTS.md`,
`CLAUDE.md`, `GEMINI.md`, Copilot instructions, and Cursor rules as thin
routers. Put durable high-frequency operating guidance in reference docs and
link it from the shortest relevant entrypoint.
