# Account Settings X Layout Spec

- Status: active
- Source of truth: live authenticated DOM from X Developer Console
- Workflow baseline: [x_console_live_dom_workflow.md](/home/alex/Documents/cliff/Synapse-Network/docs/01_Product_Frontend/owner_agent_guide/x_console_live_dom_workflow.md)
- Reference route: `https://console.x.com/accounts/{account_id}/settings`

## 1. Measurement source

Captured on local logged-in Chrome using:

```bash
python scripts/export_x_console_cookies.py --output /tmp/x_console_cookies.json

node scripts/measure_x_console_settings.mjs \
  --cookies /tmp/x_console_cookies.json \
  --output /tmp/x_console_settings_metrics.json \
  --screenshot /tmp/x_console_settings.png
```

Artifacts:

- screenshot: `/tmp/x_console_settings.png`
- metrics: `/tmp/x_console_settings_metrics.json`

## 2. Measured X tokens

### 2.1 Content shell

- top shell header height: `64px`
- content column width: `768px`
- content column height on sampled page: `354px`
- title block bottom padding: `32px`
- title block total height: `97px`
- row section vertical padding: `32px`
- section border color: `#232323`
- row gap between copy column and CTA column: `16px`

### 2.2 Typography

- page title:
  - size: `24px`
  - line-height: `32px`
  - weight: `400`
  - color: `#ffffff`
- page subtitle:
  - size: `16px`
  - line-height: `24px`
  - weight: `400`
  - color: `rgb(156 163 175)`
- row title:
  - size: `18px`
  - line-height: `28px`
  - weight: `500`
  - color: `#ffffff`
- row body:
  - size: `14px`
  - line-height: `20px`
  - weight: `400`
  - color: `rgb(156 163 175)`

### 2.3 CTA buttons

- primary pill CTA height: `36px`
- pill horizontal padding: `16px`
- primary CTA font:
  - size: `13px`
  - line-height: `13px`
  - weight: `600`
- light CTA background: `rgba(255,255,255,0.95)`
- pill radius: `9999px`
- sampled primary CTA width: `196.28px`
- sampled secondary CTA width: `132.84px`

## 3. Synapse adaptation rule

Synapse Account Settings should preserve the X shell rhythm while swapping the semantic rows:

1. account name
2. email
3. earning reports
4. budget alerts
5. connected wallet
6. save

Important:

- Keep X density, not X content.
- Do not reintroduce dashboard cards.
- Prefer section rows with bottom borders over boxed panels.
- Remove onboarding-style explanations. This page is for operators and developers, not first-time retail users.
- Save remains wallet-signed, even though X uses simple outbound CTA rows.

## 4. Applied Synapse implementation target

- outer page content column: `768px`
- page title: `24/32`
- page subtitle: `16/24`
- each settings row: `32px` vertical padding with `#232323` divider
- settings row title: `18/28 medium`
- settings row body: `14/20`
- right control rail width: `264px` max
- save CTA height: `36px`
- inputs:
  - height: `40px`
  - radius: `12px`
  - border: `#2f3336`

## 5. Why the previous page drifted

The previous Synapse page overshot X because it behaved like a web3 control panel:

- oversized `42px` title
- multiple bordered cards
- inspector sidebar
- rounded corners too large
- input and toggle groups visually boxed instead of row-based

That made the page feel heavier and more “settings dashboard” than X’s minimal control-plane list.
