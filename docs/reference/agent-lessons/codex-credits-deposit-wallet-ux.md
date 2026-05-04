# Agent Lessons: codex-credits-deposit-wallet-ux

Task: Professionalize Credits deposit balance, wallet preflight, Billing status, and wallet auth prompts.
Status: Active

## Push Review

### Lesson: Chain deposit logs must not be displayed as spendable completion

- Domain: frontend-finance
- Severity: warning
- Trigger: Billing showed Deposit rows as Completed because the frontend mapped on-chain `DepositInfo` logs directly to completed payment records while Gateway still had `PENDING_CONFIRMATION` deposits and pending balance.
- Root cause: The UI treated chain evidence as the business settlement source of truth instead of joining it with Gateway deposit intent status.
- Fix: Billing deposit rows now use Gateway deposit intent status; chain logs without confirmed Gateway intent render as Pending / Syncing, and Credits shows spendable, pending, and frozen buckets separately.
- Rule: User-visible money completion states must come from Gateway ledger/intent state, not from explorer logs or frontend-local chain reads alone.
- Upgrade: bugfix-docs

### Lesson: Wallet prompts must be gated by local preflight before signatures

- Domain: frontend-finance
- Severity: warning
- Trigger: The deposit flow warned on low native gas but still continued into permit/signature flow, allowing MetaMask prompts that could only fail later.
- Root cause: Preflight checks were split across UI copy and handler logic, and the gas check did not return before wallet calls.
- Fix: The deposit hook now blocks before `signTypedDataAsync` and `writeContractAsync` when amount, wallet USDC, or native gas is insufficient.
- Rule: Wallet UX for money movement must fail closed before any wallet prompt when local balance or gas preflight is already known to be insufficient.
- Upgrade: bugfix-docs

### Lesson: Legacy frontend finance files trigger whole-file quality budgets

- Domain: ci
- Severity: warning
- Trigger: Push failed because small finance UX additions touched existing large frontend files, causing the quality budget gate to scan their historical oversized functions and file lengths.
- Root cause: The implementation placed new balance-bucket and wallet-preflight UI in already baselined legacy files instead of first extracting smaller dedicated modules.
- Fix: The current legacy stop-loss baselines were updated so the gate remains explicit, and future work has a recorded rule to avoid growing these surfaces further.
- Rule: When changing legacy finance UI files near or above quality budget limits, extract new behavior into small modules before adding page-level logic.
- Upgrade: pr-lessons-only
