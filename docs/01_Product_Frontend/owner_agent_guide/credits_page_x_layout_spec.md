# Credits Page X Layout Spec

- Status: active
- Scope: [OwnerCreditsPage.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/OwnerCreditsPage.tsx)
- Source of truth: authenticated live DOM measurement from `console.x.com`
- Workflow baseline: [x_console_live_dom_workflow.md](/home/alex/Documents/cliff/Synapse-Network/docs/01_Product_Frontend/owner_agent_guide/x_console_live_dom_workflow.md)

## 1. Measurement source

This spec is no longer screenshot-only.

The current values were extracted from the real logged-in X page:

- URL: `https://console.x.com/accounts/2038798078744948737/billing/credits`
- Auth source: local Chrome cookies
- Extraction chain:
  1. `browser_cookie3`
  2. Playwright cookie injection
  3. `getBoundingClientRect()`
  4. `getComputedStyle()`

Measured artifacts:

- screenshot: `/tmp/x_console_credits.png`
- metrics: `/tmp/x_console_credits_metrics.json`

## 2. Page structure

The real X page is not a stack of identical cards.

The live DOM structure is:

1. header block with bottom divider
2. `py-8 border-b` section
3. remaining balance card
4. billing cycle card
5. manage spend cap card
6. second `py-8 border-b` section
7. free credits voucher row

Important:

- `Free Credits Voucher` is a section row, not a boxed card
- `Remaining balance` in Synapse should use a double-wrap shell: outer billing container + inner X-style panel
- Synapse override: `Remaining balance` inner panel background is unified to `#1a1a1a` so it matches `Current Billing Cycle`, instead of keeping X's darker black panel
- `Billing Cycle` and `Manage Spend Cap` use `#1a1a1a` surfaces with `8px` radius

## 3. Measured layout values

### 3.1 Main column

| Item | Value |
|---|---:|
| content column width | `768px` |
| header top offset from shell | `48px` |
| section vertical padding | `32px` |
| card gap inside first section | `24px` |
| voucher section padding | `32px 0` |

### 3.2 Header block

| Item | Value |
|---|---:|
| title font size | `24px` |
| title line height | `32px` |
| title weight | `400` |
| subtitle font size | `16px` |
| subtitle line height | `24px` |
| subtitle color | `#9ca3af` |
| divider color | `#2f3336` |

### 3.3 Remaining balance card

| Item | Value |
|---|---:|
| outer wrapper radius | `16px` |
| outer wrapper padding | `16px` |
| outer wrapper background | `#16181c` |
| outer wrapper border | `1px solid #2f3336` |
| card width | `768px` |
| card height | `148px` |
| card radius | `12px` |
| card padding | `16px` |
| card background | `#1a1a1a` |
| card border | `1px solid #232323` |
| label font size | `14px` |
| label line height | `20px` |
| label color | `#9ca3af` |
| balance value font size | `24px` |
| balance value line height | `32px` |
| balance value weight | `700` |
| purchase button height | `36px` |
| purchase button width | `142.9px` |
| purchase button padding | `8px 16px` |
| purchase button radius | `9999px` |
| purchase button font | `14px / 20px / 400` |
| purchase button background | `#eff3f4` |
| purchase button text | `#0f141a` |

### 3.4 Billing cycle card

| Item | Value |
|---|---:|
| card width | `768px` |
| card height | `82px` |
| card radius | `8px` |
| card padding | `16px` |
| card background | `#1a1a1a` |
| card border | `1px solid #323232` |
| left icon size | `16px` |
| left group gap | `12px` |
| label font | `14px / 20px / 400` |
| value font | `16px / 24px / 500` |

### 3.5 Manage spend cap card

| Item | Value |
|---|---:|
| card width | `768px` |
| card height | `278px` |
| card radius | `8px` |
| card padding | `24px` |
| card background | `#1a1a1a` |
| card border | `1px solid #323232` |
| card gap | `16px` |
| title font | `18px / 28px / 500` |
| description font | `14px / 20px / 400` |
| description width | `~540px` |
| CTA height | `36px` |
| CTA width | `162.5px` |
| CTA font | `14px / 20px / 400` |
| metric label font | `12px / 16px / 500` |
| metric label color | `#a3a3a3` |
| metric value font | `24px / 32px / 600` |
| progress track height | `12px` |
| progress track color | `#262626` |
| usage text font | `14px / 20px / 400` |
| usage text color | `#71767b` |

### 3.6 Voucher section

| Item | Value |
|---|---:|
| section width | `768px` |
| section wrapper | `py-8 border-b` |
| title font | `18px / 28px / 500` |
| body font | `14px / 20px / 400` |
| body width | `512px` |
| CTA height | `36px` |
| CTA width | `145.4px` |
| CTA font | `14px / 20px / 400` |

## 4. Implementation rules

1. Do not wrap every Credits block in the same card shell.
2. Keep the page at `768px` max content width.
3. Use `8px` radius for the `#1a1a1a` cards and `12px` radius for the balance card.
4. Keep CTA height at `36px`; do not inflate buttons to `48px`.
5. Keep the balance number at `24px`, not oversized hero numerals.
6. Keep voucher as a bordered section row, not a boxed panel.
7. The current Synapse Credits page intentionally omits the `Auto Recharge unavailable` block to keep the billing surface simpler.
8. Synapse intentionally uses the same `#1a1a1a` content background for `Remaining balance` and `Current Billing Cycle` to reduce visual discontinuity.

## 5. Validation

Minimum validation after any Credits layout change:

```bash
cd apps/frontend && npx tsc --noEmit
cd apps/frontend && npx vitest run src/components/dashboard-workspace/OwnerCreditsPage.test.tsx
```
