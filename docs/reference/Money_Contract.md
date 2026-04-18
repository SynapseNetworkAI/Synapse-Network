# Money Contract

- Status: canonical
- Owners: gateway, gateway-admin, admin-front, user-front
- Last verified against code: 2026-04-18

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
- Do not hand-roll `int(amount * 10**decimals)` in business code.

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
amount_atomic = usdc_decimal_to_atomic(net, decimals=18)
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
- All money changes include matching tests and docs updates.
