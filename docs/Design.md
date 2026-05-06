# SynapseNetwork Design Notes

## Canonical Logo

SynapseNetwork has one canonical product logo in the user-front app:

```text
services/user-front/public/logo-mark.svg
```

This is the same logo used in the top-left of `http://localhost:3000/`. Use it for marketing pages, the About page, docs chrome, dashboard chrome, and screenshots.

Mirrored brand/favicon assets may exist for framework metadata or export compatibility:

```text
services/user-front/public/brand/synapse-network-icon.svg
services/user-front/public/brand/synapse-network-logo.svg
services/user-front/public/icon.png
services/user-front/public/apple-touch-icon.png
services/user-front/src/app/favicon.ico
```

Do not introduce alternate About-only logos or generated logo marks. If the logo needs to change, update the canonical logo asset first and let every page inherit that one source of truth.

Keep PNG/ICO fallbacks in sync with the canonical logo. Browser extensions and wallets do not always fetch SVG favicons reliably, so user-front must expose `/favicon.ico`, `/icon.png`, and `/apple-touch-icon.png` for wallet prompts and browser chrome.

## About Page Visual Reference

The About page desktop hero is based on:

```text
docs/design/reference/about-gpt-image2.png
```

Validation helper:

```bash
npm run ui:about-visual
```

The generated evidence is written to:

```text
output/playwright/about-visual/
```
