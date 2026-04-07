# Synapse Developer Console — Page-Level Automated Test Plan

**Base URL:** `http://localhost:3000`  
**Testing method:** agent-browser (screenshot + interaction)  
**Date:** 2026-04-07  
**Coverage:** All 13 dashboard pages accessible from the sidebar nav

---

## Page Index

| # | Page | Route | Test Plan |
|---|------|-------|-----------|
| 1 | Overview | `/dashboard/overview` | [overview.md](./overview.md) |
| 2 | Agents | `/dashboard/agents` | [agents.md](./agents.md) |
| 3 | Discovery | `/dashboard/discovery` | [discovery.md](./discovery.md) |
| 4 | Invocations | `/dashboard/invocations` | [invocations.md](./invocations.md) |
| 5 | Billing | `/dashboard/billing` | [billing.md](./billing.md) |
| 6 | Billing / Credits | `/dashboard/billing/credits` | [billing-credits.md](./billing-credits.md) |
| 7 | Risk & Audit | `/dashboard/audit` | [audit.md](./audit.md) |
| 8 | Developer Resources | `/dashboard/developer` | [developer.md](./developer.md) |
| 9 | Provider Console | `/dashboard/console` | [console.md](./console.md) |
| 10 | Provider Credentials | `/dashboard/credentials` | [credentials.md](./credentials.md) |
| 11 | My Services | `/dashboard/services` | [services.md](./services.md) |
| 12 | Settlements | `/dashboard/settlement` | [settlement.md](./settlement.md) |
| 13 | Account Settings | `/dashboard/account/settings` | [account.md](./account.md) |

## Test Execution Protocol

1. `agent-browser open <url>` — navigate to page
2. `agent-browser screenshot screenshots/<page>.png` — visual capture
3. `agent-browser snapshot -i` — inspect interactive elements
4. Verify: page renders without crash, key sections visible, no console errors in network responses
5. Log bugs to `../../bugfix/gateway/<page>/bugs.md`

## Bug Severity Legend

- **P0** — Page crashes / blank screen / 500 error
- **P1** — Core feature non-functional (broken API call, missing data)
- **P2** — UI regression (wrong layout, misaligned elements, i18n missing)
- **P3** — Minor cosmetic / polish issue
