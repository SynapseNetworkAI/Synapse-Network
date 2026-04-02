# X Console Live DOM Workflow

- Status: active
- Scope: all Synapse frontend work that aims to match `console.x.com`
- Canonical use case: layout, typography, spacing, button, and card parity work

## 1. Why this exists

Screenshot guessing is not enough for X parity work.

The safe path is:

1. read the live authenticated DOM
2. extract `getBoundingClientRect()` and `getComputedStyle()`
3. write the measurements into docs
4. then change Synapse UI

If we skip step 1, components drift fast:

- buttons become too tall
- numbers become oversized
- cards get over-rounded
- layouts become more "dashboard-y" than X

## 2. Decision

For X-alignment work, the source of truth is a repo-local toolchain, not a prompt-only workflow.

Recommended split:

1. keep the measurement logic as scripts under `tools/scripts/ui/`
2. keep the extraction contract in docs
3. use a skill only if we later want Codex to wrap the same scripts across multiple repos

Current recommendation:

- do extract tools now
- do not make this a dedicated skill yet

Reason:

- tools are executable
- tools produce reusable JSON and screenshots
- tools can be checked into docs and PRs
- a skill alone cannot prevent future drift

## 3. Prerequisites

1. you are already logged into Chrome on the local machine
2. Chrome profile contains valid `x.com` / `console.x.com` cookies
3. local machine has:
   - Python 3
   - `browser-cookie3`
   - Node.js
   - repo root `npm install` already run
   - Chrome at `/opt/google/chrome/chrome`

Install helpers when needed:

```bash
python -m pip install --user browser-cookie3
```

Install repo JS dependencies when needed:

```bash
npm install
```

## 4. Standard flow

### 4.1 Export authenticated cookies

```bash
python tools/scripts/ui/export_x_console_cookies.py --output /tmp/x_console_cookies.json
```

### 4.2 Measure the real X Credits page

```bash
node tools/scripts/ui/measure_x_console_credits.mjs \
  --cookies /tmp/x_console_cookies.json \
  --output /tmp/x_console_credits_metrics.json \
  --screenshot /tmp/x_console_credits.png
```

### 4.3 Record the measured values

After each run:

1. update the spec doc for the page
2. note whether values came from:
   - live DOM
   - fallback screenshot estimation
3. keep the output screenshot path in the work log or PR notes

### 4.4 Only then modify Synapse UI

The implementation order must be:

1. measure
2. document
3. implement
4. validate

## 5. What must be extracted

For each X reference page, extract:

1. content column width
2. top padding from shell header
3. card/section width and height
4. border radius
5. padding and gap
6. type scale:
   - font size
   - line height
   - font weight
7. CTA size:
   - height
   - width
   - padding
8. color values:
   - background
   - text
   - border

## 6. Fallback rules

If live DOM cannot be read:

1. do not claim 1:1 parity
2. clearly mark the result as screenshot-derived
3. bias toward smaller / tighter X density
4. rerun live extraction before final polishing

## 7. Validation rules

For any page changed using this workflow:

1. update the page-specific spec doc in `docs/`
2. update the frontend implementation
3. run `cd apps/frontend && npx tsc --noEmit`
4. run page-specific tests when present

## 8. Current scripts

- Cookie export:
  - [export_x_console_cookies.py](/home/alex/Documents/cliff/Synapse-Network/tools/scripts/ui/export_x_console_cookies.py)
- Credits measurement:
  - [measure_x_console_credits.mjs](/home/alex/Documents/cliff/Synapse-Network/tools/scripts/ui/measure_x_console_credits.mjs)

## 9. Adoption rule

From now on, any Synapse request phrased as:

- "参考 X UI"
- "和 X 一模一样"
- "提取 X 的 px / 字体 / 间距"

must use this live DOM workflow first whenever authenticated access is available.
