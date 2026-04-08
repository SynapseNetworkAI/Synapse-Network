# BUG-SCREENSHOT-01 — Provider-Wallet Screenshots Render Blank White Pages

**Severity:** Medium  
**Component:** `tools/scripts/fullchain_wallet_test.js` — Playwright E2E screenshot harness  
**Reported:** 2026-04-08  
**Status:** Fixed

---

## Summary

When taking screenshots of `/provider/console`, `/provider/services`, and `/provider/credentials`
with the **provider wallet** (`PROVIDER_KEY`) injected into a separate Playwright browser context,
all screenshots are completely blank white (pure white pixels, zero content).

---

## Symptoms

- Screenshots 13-15 (`10-provider-console-provider-wallet.png`, etc.) are 1440×900 pure white images.
- No React rendering visible — not even a "Connect Wallet" empty state.
- The buyer-wallet screenshots (same pages, same pattern) render correctly.

---

## Root Cause

Two compounding issues:

1. **Simplified `window.ethereum` mock** — The provider context used a minified fake `window.ethereum`
   with a no-op `on(e,fn){}`. wagmi v2 registers `accountsChanged` and `chainChanged` event listeners
   via `on()`. Without listener storage, wagmi's reconnect flow fires the right RPC calls but can never
   get notified of auth state updates, leaving `wagmi.store.state.status` in an infinite `reconnecting`
   state. The `waitForFunction` call times out, and the page renders a white loading state.

2. **Separate browser context warming** — Navigating directly to `/provider/console` as the FIRST
   page in a fresh Playwright context means the init script sets localStorage correctly, but wagmi's
   async reconnect cycle hasn't completed before the screenshot is taken. The app renders blank.

---

## Fix

Reuse the existing buyer browser context (already connected and warmed up). After all buyer screenshots:

1. Use `page.evaluate()` to temporarily inject the provider auth session into `localStorage`.
2. Update `wagmi.injected.connected` and `wagmi.recentConnectorId` without changing `window.ethereum`
   (the session auth is what the app needs, not a different wallet object).
3. Navigate to `/provider/console` inside the same context — wagmi is already connected, and the
   server-side API calls will use the updated `a2a_auth_session` bearer token.
4. Take screenshots.
5. Restore original buyer session after provider screenshots.

This approach avoids the wagmi reconnect problem entirely and produces correct renders.

---

## After-Fix Verification

Re-run `node tools/scripts/fullchain_wallet_test.js --screenshot-only` and confirm:
- Screenshot 13: `/provider/console` — shows net earnings, services count from provider wallet
- Screenshot 14: `/provider/services` — shows 2 registered services (`svc_e2e_provider_quotes`, `svc_e2e_provider_sentiment`)  
- Screenshot 15: `/provider/credentials` — shows provider signing secret
