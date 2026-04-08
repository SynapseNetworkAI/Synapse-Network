# Full-Chain E2E Test Report

**Date:** 2026-04-07 23:46:24  
**Wallet:** `0x90F79bf6EB2c4f870365E785982E1f101E93b906` (Hardhat #3)  
**Checklist:** 21/21 passed  

## Summary

| Metric | Value |
|---|---|
| USDC Deposited | 10.0 |
| Agents Created | 9 |
| Invocations Made | 20 |
| Balance (USDC) | 10.0078 |
| API Checks | 21/21 |

## API Checklist

| Status | Check | Detail |
|---|---|---|
| ✅ | Auth /me returns wallet address | 0x90f79bf6eb2c4f870365e785982e1f101e93b906 |
| ✅ | Balance endpoint responds | — |
| ✅ | Consumer balance > 0 | 9.9573 USDC |
| ✅ | Credentials list returns array | — |
| ✅ | Buyer has ≥ 3 agents | 10 agents |
| ✅ | Each agent has name and status | — |
| ✅ | Agents have active status | — |
| ✅ | Usage logs endpoint responds | — |
| ✅ | Usage logs has invocation records | 20 records |
| ✅ | Log has status field | — |
| ✅ | Log has totalCharge field | — |
| ✅ | Invocations show succeeded status | — |
| ✅ | Deposit intents endpoint responds | — |
| ✅ | Deposit records exist | 2 records |
| ✅ | Service discovery endpoint responds | 8 services |
| ✅ | Services have status field | — |
| ✅ | Audit logs endpoint responds | — |
| ✅ | Audit logs has entries | 6 entries |
| ✅ | Spending limit endpoint responds | — |
| ✅ | Network stats endpoint responds | — |
| ✅ | Credential audit logs respond | — |

## Screenshots

| File | URL |
|---|---|
| `01-00-home.png` | `/` |
| `02-01-overview.png` | `/dashboard/overview` |
| `03-02-agents.png` | `/dashboard/agents` |
| `04-03-invocations.png` | `/dashboard/invocations` |
| `05-04-billing.png` | `/dashboard/billing` |
| `06-05-billing-credits.png` | `/dashboard/billing/credits` |
| `07-06-discovery.png` | `/dashboard/discovery` |
| `08-07-developer.png` | `/dashboard/developer` |
| `09-08-audit.png` | `/dashboard/audit` |
| `10-09-settings.png` | `/dashboard/account/settings` |
| `11-10-provider-console.png` | `/provider/console` |
| `12-11-provider-services.png` | `/provider/services` |
| `13-10-provider-console-provider-wallet.png` | `/provider/console` |
| `14-11-provider-services-provider-wallet.png` | `/provider/services` |
| `15-12-provider-credentials-provider-wallet.png` | `/provider/credentials` |

## Notes

- Browser: Google Chrome (system), headless  
- Wallet injection: fake `window.ethereum` provider (no MetaMask)  
- Auth: `a2a_auth_session` pre-injected to localStorage  
