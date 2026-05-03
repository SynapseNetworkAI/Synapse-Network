# Agent Task Map

- Status: canonical
- Code paths: `docs/reference/Agent_Task_Map.*`, `llms.txt`, `AGENTS.md`, `.github/instructions/`, `services/`, `contracts/`
- Verified with: `npm run ci:docs`
- Last verified against code: 2026-04-25

This page is the task-to-file index for AI agents working in `Synapse-Network`.

Use it before broad repository search. It does not replace `AGENTS.md`, `.github/instructions/`, or the project README files. It tells an agent where to start for a class of work, which files are usually authoritative, and which validation commands usually prove the change.

## Files

1. [Agent_Task_Map.json](./Agent_Task_Map.json) - machine-readable domain map for agents and workflow tools.
2. This page - human-readable operating rules and maintenance notes.

## How Agents Should Use This Map

1. Read root `llms.txt`.
2. Read root `AGENTS.md` and the relevant `.github/instructions/*.instructions.md`.
3. Pick the closest domain in [Agent_Task_Map.json](./Agent_Task_Map.json).
4. Open the domain `primary_files` first, then only use broad search if those files do not answer the question.
5. Run the listed validation commands when the change touches that domain.

## Domain Summary

| Domain                        | Use when the task mentions                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `gateway_runtime`             | agent invoke, discovery, credentials, provider service calls, runtime API contracts                |
| `docs_front`                  | `localhost:3100`, docs.synapse-network.ai, MDX docs pages, OpenAPI API reference, public docs copy |
| `user_front_docs`             | legacy `/docs/*` redirects and product links into the dedicated docs project                       |
| `user_front_product`          | marketplace, owner console, public app pages, product-facing frontend                              |
| `sdk_contract_alignment`      | SDK docs in product docs, SDK onboarding, public preview environment copy                          |
| `finance_sensitive_backend`   | balance, deposits, withdrawals, refunds, settlement, ledger, audit                                 |
| `admin_finance_control_plane` | gateway-admin, admin-front, withdrawal review, refund approval                                     |
| `contracts_and_deployments`   | Solidity contracts, Hardhat, staging/prod deployment evidence                                      |
| `docs_governance`             | docs structure, canonical README metadata, retired paths, docs CI                                  |
| `ci_and_quality_gates`        | CI scripts, validation entrypoints, PR gates, local check commands                                 |

## Update Rules

Update [Agent_Task_Map.json](./Agent_Task_Map.json) in the same change when:

1. A canonical implementation file moves.
2. A validation command changes.
3. A new recurring task class appears.
4. A public docs page, route, or API contract changes ownership.
5. A domain starts requiring a different `.github/instructions/*.instructions.md` file.

Do not put secrets, credentials, private URLs, or one-off incident details in this map. Link to stable docs instead.

## Validation

Run:

```bash
npm run ci:docs
node -e "JSON.parse(require('fs').readFileSync('docs/reference/Agent_Task_Map.json', 'utf8'))"
```
