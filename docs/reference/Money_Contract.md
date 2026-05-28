# Money Contract

- Status: canonical
- Owners: gateway, gateway-admin, admin-front, user-front
- Code paths: `services/gateway/src/`, `services/gateway-admin/src/`, `services/admin-front/src/`, `services/user-front/src/`, `scripts/ci/`
- Last verified against code: 2026-05-28

## Purpose

This document is the canonical money contract for Synapse.

Money fields must obey one invariant across the stack:

`Money crosses boundaries as string, computes as Decimal, stores as NUMERIC(36, 6).`

## Layer Rules

### Database

- Money columns must use `NUMERIC(36, 6)` unless a narrower precision is explicitly justified.
- Do not store money in floating-point database columns.
- USDC uses 6 decimal places as the canonical settlement scale.

### Python backend

- All money arithmetic must use `decimal.Decimal`.
- Money helpers must not accept `float`.
- Use `Decimal.quantize()` through the shared money helpers instead of `round()`.
- Chain atomic conversion must go through shared helpers such as `usdc_decimal_to_atomic()`.
- Chain atomic conversion must use the deployed token's actual `decimals()` value or a verified environment config. Never assume USDC is 18 decimals; production Arbitrum One USDC is 6 decimals while local MockUSDC may be 18.
- Do not hand-roll `int(amount * 10**decimals)` in business code.
- Deposit confirmation and withdrawal completion are chain-evidence operations. User-facing routes must not move money from client-provided `eventKey`, `confirmations`, or `txHash` alone; Gateway must verify receipt status, contract address, event payload, owner, amount, fee, and ticket hash before mutating balances.
- Balance bucket locks and the corresponding business row must be created atomically. If legacy code must reserve first and write the row second, it must release the reserved `pending`/`frozen` amount on any row-write failure before returning an error.

### HTTP / JSON / analytics payloads

- Money fields must be serialized as strings.
- Do not emit JSON numbers for `*Usdc`, `*Balance`, `*Fee`, `*Net`, `*Charge`, `*Refund`, or `*Withdrawal` fields.
- Analytics event payloads must also use string money fields. ClickHouse parsing happens downstream under controlled typing.

### TypeScript frontend

- Business-layer money fields must be typed as string contracts such as `MoneyString`.
- Do not model money as `number` in API adapters, presenters, or business state.
- Display formatting must consume strings.
- If a chart library requires numbers, convert through one explicit display-only helper such as `parseMoneyStringForChart()`.
- Chart-only numeric conversions must never feed business logic back into balances, approvals, settlement, or validations.

## Allowed Examples

```python
from decimal import Decimal
from src.utils.money import parse_usdc, usdc_decimal_to_atomic, money_str

amount = parse_usdc("12.345678")
fee = parse_usdc("0.100000")
net = parse_usdc(amount - fee)
token_decimals = read_usdc_decimals_from_chain()
amount_atomic = usdc_decimal_to_atomic(net, decimals=token_decimals)
payload = {"amountUsdc": money_str(net)}
```

```ts
const amountUsdc: MoneyString = "12.345678";
const label = `${formatMoneyString(amountUsdc, 2)} USDC`;
const chartValue = parseMoneyStringForChart(amountUsdc); // display-only
```

## Forbidden Examples

```python
amount = round(float(row.amount_usdc), 6)
net_wei = int(amount * 10**18)
confirmed = confirm_deposit_intent(event_key=request.eventKey, confirmations=request.confirmations)
```

```ts
const totalAmount = rows.reduce((sum, row) => sum + Number(row.amountUsdc), 0);
const payload = { amountUsdc: 12.34 };
```

## Review Checklist

- No `float` in money arithmetic, helper signatures, or balance comparisons.
- No `round()` on money paths.
- No JSON number money fields in API responses or analytics payloads.
- No `Number(amountUsdc)` or `parseFloat(amountUsdc)` in frontend business logic.
- No hardcoded `18` decimals in USDC withdraw/deposit business logic unless the code path is explicitly local MockUSDC-only and documented.
- Deposit confirm and withdrawal complete paths verify on-chain receipt/event evidence before moving pending/frozen balances or marking rows terminal.
- Withdrawal request creation cannot leave funds locked without a matching withdrawal row; tests must cover row-write failures for both pending and manual-review locks.
- All money changes include matching tests and docs updates.
