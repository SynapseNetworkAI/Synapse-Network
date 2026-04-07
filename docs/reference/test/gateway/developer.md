# Test Plan: Developer Resources Page

**Route:** `/dashboard/developer`  
**Component:** `DashboardDeveloperPage`

## Purpose
SDK quickstart, code samples (TS + Python), install commands, doc links.

## Test Cases

### TC-DE-01: Page renders without crash
- Navigate to `/dashboard/developer`
- **Expected:** Page loads with code blocks visible

### TC-DE-02: SDK toggle (TS / Python)
- Click Python tab
- **Expected:** Python code block shown; install command changes to `pip install ...`
- Click TypeScript tab
- **Expected:** TS code block shown; install command changes to `npm install ...`

### TC-DE-03: Copy button on install command
- Click copy icon next to install command
- **Expected:** Visual feedback (tooltip) "Copied"

### TC-DE-04: Copy button on code block
- Click copy on code sample
- **Expected:** Visual feedback shown

### TC-DE-05: Show more / expand
- If "Show more" button present, click it
- **Expected:** Additional code lines revealed

### TC-DE-06: Doc links present
- **Expected:** At least one external link to documentation visible

## Pass Criteria
Page loads, SDK toggle works, copy buttons functional.
