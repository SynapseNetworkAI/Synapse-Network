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

## BUG-SDK-003 — "Balance After Settlement" test uses wrong upper bound

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
