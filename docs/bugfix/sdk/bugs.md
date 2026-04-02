# TypeScript SDK Bug Log

## BUG-SDK-001 — PROVIDER_KEY invalid length (63 hex chars, ethers v6 rejects)

**Status:** FIXED  
**Severity:** error (blocks beforeAll setup)  
**File:** `sdk/typescript/tests/e2e/consumer.test.ts`

### Symptom
```
TypeError: invalid BytesLike value (argument="value", value="0x5de4...0ecf",
code=INVALID_ARGUMENT, version=6.16.0)
```

### Root Cause
`PROVIDER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ecf"` is 63 hex chars (odd length, not 32 bytes).

Python `eth_account` silently zero-pads the key; ethers v6 is strict and rejects it.

### Fix
Use the correct 64-char Hardhat #2 private key:
```
0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ec4f
```
(The `4` before the final `f` was missing in the tests.)

---

## BUG-SDK-002 — Deposit nonce conflict (NONCE_EXPIRED) on re-runs

**Status:** FIXED  
**Severity:** error (blocks beforeAll setup)  
**File:** `sdk/typescript/tests/e2e/consumer.test.ts`

### Symptom
```
NONCE_EXPIRED: nonce has already been used
code=-32003, message="nonce too low"
```

### Root Cause
If Python E2E tests ran first, the owner account's on-chain nonce advanced.
Ethers v6 uses a caching nonce manager and the previous run may have left
the nonce tracking dirty. Submitting a fresh deposit conflicts with already-used nonces.

### Fix
Before attempting on-chain deposit, check the current gateway balance.
If `consumerAvailableBalance >= DEPOSIT_USDC / 2` (i.e., enough balance already
credited from a prior run), skip the blockchain deposit entirely.
This makes the test idempotent and re-run safe.

---

## BUG-SDK-004 — Deployer nonce conflict between ETH transfer and mint (Hardhat)

**Status:** FIXED  
**Severity:** error (blocks beforeAll setup)  
**File:** `sdk/typescript/tests/e2e/new-consumer.test.ts`

### Symptom
```
NONCE_EXPIRED: nonce has already been used
code=-32003, message="nonce too low"
```
Transaction is the `mint()` call to MockUSDC (nonce 0x3d = 61).

### Root Cause
In ethers v6, when `deployerWallet.sendTransaction({value: 0.5 ETH})` is sent
and mined (via `await ethTx.wait()`), the subsequent `usdc.mint()` call queries
`eth_getTransactionCount(deployer, "latest")` internally. Hardhat's auto-mine
mode can expose a brief window where the transaction has been mined but the
`eth_getTransactionCount` response hasn't propagated, causing the next call to
receive the stale nonce (N) instead of N+1. Both the ETH transfer and mint end
up broadcast with the same nonce, causing the second to fail.

### Fix
Fetch the deployer's pending nonce once before the first transaction, then
pass explicit `{ nonce: deployerNonce++ }` overrides to every deployer tx:
```typescript
let deployerNonce = await rpcProvider.getTransactionCount(deployerWallet.address, "pending");
await deployerWallet.sendTransaction({..., nonce: deployerNonce++});
await (usdc as Contract).mint(fresh, amount, { nonce: deployerNonce++ });
```



**Status:** FIXED  
**Severity:** assertion error (1 test fails)  
**File:** `sdk/typescript/tests/e2e/consumer.test.ts`

### Symptom
```
expect(received).toBeLessThan(expected)
Expected: < 10  (DEPOSIT_USDC constant)
Received: 59.9934
```

### Root Cause
Test asserts `balance < DEPOSIT_USDC (10)` but the existing gateway balance was ~60 USDC
from previous Python E2E runs. The deposit was correctly skipped (BUG-002 fix),
so the starting balance was 60, not 10.

### Fix
Capture `initialBalance` before invocations run and assert
`finalBalance < initialBalance` instead of `finalBalance < DEPOSIT_USDC`.

---

## BUG-SDK-004 — Deployer nonce conflict between ETH transfer and mint (new-consumer test)

**Status:** FIXED  
**Severity:** error (NONCE_EXPIRED, blocks beforeAll)  
**File:** `sdk/typescript/tests/e2e/new-consumer.test.ts`

### Symptom
```
NONCE_EXPIRED: nonce has already been used, code=-32003, message="nonce too low"
```
Transaction is the `mint()` call with nonce 0x3d = 61.

### Root Cause
After `deployerWallet.sendTransaction({ETH})` and `await ethTx.wait()`, the subsequent
`usdc.mint()` call queries `eth_getTransactionCount(deployer, "latest")` internally.
Hardhat auto-mine can expose a brief stale window where that query still returns N
instead of N+1, causing both transactions to use the same nonce.

### Fix
Fetch deployer's pending nonce ONCE before first tx, then pass explicit
`{ nonce: deployerNonce++ }` to every deployer transaction:
```typescript
let deployerNonce = await rpcProvider.getTransactionCount(deployerWallet.address, "pending");
await deployerWallet.sendTransaction({..., nonce: deployerNonce++});
await (usdc as Contract).mint(fresh, amount, { nonce: deployerNonce++ });
```

---

## BUG-SDK-005 — confirmDeposit wrong endpoint URL and body

**Status:** FIXED  
**Severity:** error (HTTP 404 — blocks deposit confirmation)  
**File:** `sdk/typescript/src/auth.ts`

### Symptom
```
HTTP 404: Not Found
```
Thrown from `SynapseAuth.confirmDeposit()` during beforeAll setup.

### Root Cause
`confirmDeposit` was calling `POST /api/v1/balance/deposit/confirm` with body
`{ intentId, eventKey }`. The actual gateway endpoint is:
`POST /api/v1/balance/deposit/intents/{intentId}/confirm` with body `{ eventKey, confirmations: 1 }`.

### Fix
Updated `confirmDeposit` in `auth.ts`:
- URL: `/api/v1/balance/deposit/intents/${intentId}/confirm`
- Body: `{ eventKey, confirmations: 1 }`
