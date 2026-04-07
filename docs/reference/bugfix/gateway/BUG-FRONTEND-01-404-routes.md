# BUG-FRONTEND-01 — Multiple 404 Routes in Dashboard Sidebar

**Severity:** Medium  
**Component:** `services/user-front` — Next.js routing  
**Reported:** 2026-04-07  
**Status:** Open

---

## Summary

Three sidebar navigation links resolve to 404 "Page not found" because the expected URL paths
do not map to any Next.js page under `src/app/dashboard/`.

---

## Affected Routes

| Sidebar Label       | URL navigated to                     | Status | Correct path                       |
|---------------------|--------------------------------------|--------|------------------------------------|
| Risk & Audit        | `/dashboard/risk-audit`              | 404    | `/dashboard/audit` ✓               |
| Billing > Payments  | `/dashboard/billing/payments`        | 404    | No payments sub-route exists yet   |
| Account             | `/dashboard/account`                 | 404    | `/dashboard/account/settings` ✓    |

---

## Reproduction

Navigate to any of the URLs above while the frontend is running on port 3000.

---

## Fix Recommendations

### 1. Risk & Audit link
Update the sidebar `href` from `/dashboard/risk-audit` to `/dashboard/audit`.

### 2. Billing > Payments  
Either:
- Create `src/app/dashboard/billing/payments/page.tsx` as a payments history view, or
- Remove the "Payments" link from the sidebar until the page is built, or
- Add a redirect: `/dashboard/billing/payments` → `/dashboard/billing/credits`

### 3. Account  
Add a redirect or index page at `src/app/dashboard/account/page.tsx` that redirects to
`/dashboard/account/settings`.

---

## Screenshots

- `docs/reference/test/gateway/screenshots/06-billing-payments.png` — 404
- `docs/reference/test/gateway/screenshots/07-risk-audit.png` — 404 (route typo)
- `docs/reference/test/gateway/screenshots/14-account.png` — 404
