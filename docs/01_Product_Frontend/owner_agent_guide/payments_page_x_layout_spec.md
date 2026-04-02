# Payments Page X Layout Spec

- Status: active
- Scope: [OwnerBillingPage.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/OwnerBillingPage.tsx)
- Source of truth: authenticated live DOM measurement from `console.x.com`
- Workflow baseline: [x_console_live_dom_workflow.md](/home/alex/Documents/cliff/Synapse-Network/docs/01_Product_Frontend/owner_agent_guide/x_console_live_dom_workflow.md)

## 1. Measurement source

The current values were extracted from the real logged-in X page:

- route: `https://console.x.com/accounts/2038798078744948737/billing/payments`
- extraction flow:
  1. open Credits with authenticated cookies
  2. click sidebar `Payments`
  3. wait for hydrated route render
  4. capture `getBoundingClientRect()` and `getComputedStyle()`

Measured artifacts:

- screenshot: `/tmp/x_payments_measure.png`
- metrics: `/tmp/x_console_payments_metrics.json`

## 2. Live DOM structure

The X `Payments` page uses a wider billing workspace than `Credits`.

Structure:

1. page header
2. subtitle
3. single `py-8` section
4. outer shell card
5. inner ledger card
6. top filter row
7. payment-history table

## 3. Measured values

### 3.1 Main column

| Item | Value |
|---|---:|
| content width | `1024px` |
| top offset from shell | `48px` |
| section vertical padding | `32px` |

### 3.2 Header

| Item | Value |
|---|---:|
| title font | `24px / 32px / 400` |
| subtitle font | `16px / 24px / 400` |
| subtitle color | `#9ca3af` |

### 3.3 Outer shell

| Item | Value |
|---|---:|
| width | `1024px` |
| height | `270px` |
| radius | `12px` |
| padding | `16px` |
| background | `#0d0d0d` |
| border | `1px solid #232323` |

### 3.4 Inner ledger card

| Item | Value |
|---|---:|
| width | `990px` |
| height | `236px` |
| radius | `8px` |
| padding | `24px` |
| background | `#1a1a1a` |
| border | `1px solid #323232` |

### 3.5 Filter row

| Item | Value |
|---|---:|
| row gap | `16px` |
| date field width | `320px` |
| date field height | `36px` |
| date field radius | `6px` |
| date field padding | `8px 16px` |
| date field border | `1px solid rgba(255,255,255,0.2)` |
| date field font | `14px / 20px / 400` |
| reset button height | `32px` |
| reset button radius | `6px` |
| reset button padding | `0 12px` |
| reset button font | `14px / 20px / 400` |
| reset button text color | `#6b7280` |

### 3.6 Table

| Item | Value |
|---|---:|
| header font | `14px / 20px / 500` |
| header text color | `#d1d5db` |
| header cell padding | `12px 16px` |
| header divider | `#373737` |
| body cell font | `16px / 24px / 400` |
| body cell padding | `16px` |
| transaction id font | `16px / 24px / 500` |
| status color success | `#35d07f` |
| body secondary text | `#71767b` |

## 4. Implementation rules

1. `Payments` uses a `1024px` column, not the `768px` Credits width.
2. Keep one outer shell and one inner ledger card.
3. Keep date pickers compact at `36px` height.
4. Do not turn payment method into a pill badge.
5. Preserve a single table surface instead of multiple cards or panels.

## 5. Validation

```bash
cd apps/frontend && npx tsc --noEmit
cd apps/frontend && npx vitest run src/components/dashboard-workspace/OwnerBillingPage.test.tsx
```
