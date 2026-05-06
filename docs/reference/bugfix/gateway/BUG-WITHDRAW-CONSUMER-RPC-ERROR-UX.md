# BUG: Consumer Withdrawal RPC Error Leaked Raw Backend Message

## Summary

The Credits page could show a raw nested backend error when consumer withdrawal ticket signing failed because the local or staging chain RPC was unavailable.

Example user-facing leak:

```text
Unable to prepare a withdrawal ticket right now: 503: {'code': 'CHAIN_RPC_UNAVAILABLE', ...}
```

## Impact

- Users saw infrastructure internals instead of a product-safe recovery message.
- Local developers could not tell whether the withdrawal failed because of funds, wallet action, or a missing local chain.
- The frontend could not localize this case because the consumer withdrawal adapter threw a plain `Error` without preserving the backend `code`.

## Root Cause

- Gateway reserved consumer funds before building the withdrawal ticket.
- If ticket signing raised an `HTTPException` such as `CHAIN_RPC_UNAVAILABLE`, the consumer withdrawal flow released the pending funds but wrapped the exception as `WITHDRAW_TICKET_SIGNING_FAILED`.
- User-front parsed only the message string from `/balance/consumer/withdraw`, then displayed it directly in the toast.

## Fix

- Gateway now releases the pending funds and re-raises structured `HTTPException` values unchanged.
- User-front now throws `ConsumerWithdrawApiError` with `code` and `status` for consumer withdrawal creation failures.
- `OwnerCreditsPage` maps known withdrawal error codes through i18n resources instead of showing raw backend text.
- EN/ZH copy now covers chain RPC unavailable, missing withdraw contract config, minimum amount, fee floor, insufficient balance, and T+7 matured funds.

## Verification

```bash
cd services/user-front && yarn test src/utils/balanceApi.withdraw-ticket.test.ts src/components/dashboard-workspace/OwnerCreditsPage.withdraw.test.tsx
cd services/gateway && .venv/bin/python -m pytest tests/unit/test_consumer_withdraw_unit.py -q
npm run ci:user-front-i18n
npm run ci:user-front-user-errors
npm run ci:user-front-error-dom
npm run ci:format-check
```

Browser screenshot evidence for the user-facing copy regression:

```bash
cd services/user-front && yarn dev
USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:user-front-error-browser
```

The browser runner mocks Gateway failures, verifies EN/ZH toast text in the DOM,
asserts forbidden raw strings such as `503:`, `{'code':`, `HTTPException`, and
`RPC Error` are absent, and writes screenshots plus `report.json` under
`output/playwright/user-front-error-toasts/<timestamp>/`.

## Local Triage

If this happens in local development, verify the local chain first:

```bash
curl -sS http://127.0.0.1:8545 \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

If the RPC is down, start the local chain and redeploy local contracts:

```bash
bash scripts/local/setup_local_env.sh
bash scripts/local/restart_gateway.sh
```
