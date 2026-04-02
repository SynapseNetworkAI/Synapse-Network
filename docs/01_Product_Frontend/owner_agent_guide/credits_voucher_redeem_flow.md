# Credits Voucher Redeem Flow

> Status: owner redeem loop live, admin issuance/history next slice
>
> Scope: Owner Console -> Billing -> Credits -> Redeem Voucher
>
> Related docs:
>
> 1. `docs/01_Product_Frontend/owner_agent_guide/agent_workspace_credits_ia_wireframe.md`
> 2. `docs/04_Database_Design/05_Voucher_Campaign_and_Redemption_Model.md`
> 3. `docs/06_Reference/05_Runtime_API_Contract.md`

## 1. Product Decision

`Voucher` is an owner-level free-credit grant.

It is **not**:

1. agent-scoped budget
2. credential-scoped quota
3. a discount applied at settlement time

The user mental model must stay simple:

`Redeem code -> free credits land in owner account balance -> agents can consume that balance normally`

## 2. Entry Point

Entry surface:

1. `Billing > Credits`
2. card title: `Free Credits Voucher`
3. CTA: `Redeem Voucher`

Auth rule:

1. same wallet-connect gate as `Purchase credits`
2. same wallet-session gate as `Manage Spend Cap`
3. no extra route hop; redemption happens in-place inside a modal

## 3. Modal Contract

The modal should visually mirror X's billing modal proportions instead of looking like a generic app dialog.

Desktop shell:

1. width: `562px`
2. min-height: `246px`
3. radius: `28px`
4. padding: `20px` shell rhythm

Mobile rule:

1. width: `calc(100vw - 24px)`
2. keep the same single-column structure
3. CTA remains full width

Content stack:

1. title: `Redeem Voucher Code`
2. helper copy: `Enter your voucher to add free credits to your account.`
3. single input with placeholder `XXXX-XXXX-XXXX`
4. single primary CTA: `Redeem Voucher`

## 4. Input Behavior

Voucher input rules:

1. auto-uppercase
2. strip spaces and non-alphanumeric separators
3. auto-group into `4-4-4`
4. max payload length: `12` alphanumeric chars
5. CTA stays disabled until the pattern is complete

Why:

1. reduces malformed submissions
2. keeps the visual rhythm identical to the reference modal
3. avoids adding extra help text noise under a one-field form

## 5. State Machine

### 5.1 Idle

1. empty input
2. CTA disabled
3. no banner

### 5.2 Valid Input

1. formatted code visible
2. CTA enabled

### 5.3 Redeeming

1. CTA text changes to `Redeeming Voucher...`
2. input disabled
3. close button still available

### 5.4 Success

Live behavior:

1. modal closes
2. credits balance refreshes
3. toast confirms granted amount
4. Gateway returns `redemption + balance` in one response

### 5.5 Failure

Backend must distinguish these user-facing states:

1. `INVALID_CODE`
2. `ALREADY_REDEEMED`
3. `EXPIRED`
4. `CAMPAIGN_EXHAUSTED`
5. `OWNER_NOT_ELIGIBLE`
6. `SYSTEM_UNAVAILABLE`

## 6. Live API Contract

Live endpoint:

1. `POST /api/v1/balance/vouchers/redeem`

Request body:

```json
{
  "voucherCode": "ABCD-1234-EFGH"
}
```

Successful response:

```json
{
  "ownerAddress": "0xabc...",
  "redemption": {
    "redemptionId": "vrd_01J...",
    "campaignCode": "launch-apac-q2",
    "campaignDisplayName": "Launch APAC Q2",
    "grantedAmountUsdc": "25.000000",
    "ownerAddress": "0xabc...",
    "status": "COMPLETED",
    "redeemedAt": "2026-04-02 10:22:31"
  },
  "balance": {
    "ownerBalance": 45.0,
    "providerReceivable": 0.0,
    "platformFeeAccrued": 0.0
  },
  "status": "success"
}
```

Error contract:

```json
{
  "detail": {
    "code": "VOUCHER_ALREADY_REDEEMED",
    "message": "This voucher has already been redeemed."
  }
}
```

Required header:

1. `X-Idempotency-Key`

## 7. Balance Semantics

Voucher redemption should credit the owner's main spendable balance.

That means:

1. the grant lands in the owner `consumer_wallet`
2. agents do not need a separate voucher bucket to spend it
3. existing billing-cycle spend-cap logic still applies to spend after redemption

This keeps voucher credits aligned with the current money model instead of inventing a second runtime-only balance.

## 8. Abuse and Safety Rules

Live safeguards:

1. never store raw voucher code plaintext after generation
2. rate-limit redeem attempts per owner
3. lock code row during redemption to prevent double-spend
4. persist owner + client-request idempotency in Postgres, not just Redis
5. record redeem success/failure audit events
6. keep voucher grants reversible through ledger reversal, not direct balance mutation

Still pending for admin / ops slice:

1. campaign issuance UI / API
2. redemption history API
3. owner/IP combined risk throttling
4. reversal tooling

## 9. Why This Stays Owner-Level

Making voucher redemption agent-scoped would be architectural debt.

Reasons:

1. users redeem credits for an account, not for one runtime secret
2. agent-level grants fragment balance semantics
3. X-style billing UX is account-billing first, runtime second
4. the existing Credits page already centers account balance as the primary truth
