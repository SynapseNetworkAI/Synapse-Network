# Bug Report: Provider Console

**Page:** Provider Console (`/dashboard/console`)  
**Date:** 2026-04-07  
**Status:** FIXED ✅

---

## BUG-CONSOLE-01 — Wrong redirect: `/dashboard/console` routes to Developer Resources

**Severity:** P2  
**Type:** Wrong routing / misleading redirect  
**Route affected:** `/dashboard/console`

### Observation

Navigating directly to `http://localhost:3000/dashboard/console` shows the **Developer Resources** page instead of the Provider Console.

![Console redirects to developer](../../test/gateway/screenshots/console.png)

**Root cause:** `src/app/dashboard/console/page.tsx` contains:
```tsx
import { redirect } from "next/navigation";
export default function DashboardConsoleRedirect() {
  redirect("/dashboard/developer");
}
```

The actual Provider Console lives at **`/provider/console`**, not `/dashboard/console`. The redirect target is incorrect — it should point to `/provider/console`.

### Impact

- Users who bookmark or directly type `/dashboard/console` land on Developer Resources with no indication of why.
- Sidebar nav correctly links to `/provider/console` so the bug only affects direct URL access.

### Fix

**Before:** `redirect("/dashboard/developer")`  
**After:** `redirect("/provider/console")`

### Screenshots

**Before fix** (redirects to Developer Resources):  
`screenshots/console.png`

**Correct page** (`/provider/console`):  
`screenshots/provider-console.png`

---

*Fixed in commit: see git log*
