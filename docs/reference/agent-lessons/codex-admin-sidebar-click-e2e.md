### Lesson: Admin console route coverage must click backend menu rows

- Domain: frontend
- Severity: warning
- Trigger: Local Admin sidebar showed `dashboard-overview` and `dashboard-runtime`, but users could not navigate from those visible rows when the published DB snapshot still had null hrefs.
- Root cause: The E2E only direct-goto verified routes, so it missed stale backend menu hrefs and sidebar row click target regressions.
- Fix: Compare visible menu API rows against `admin_config_documents` published menu rows, patch stale default menu fields, and click sidebar rows in E2E before taking screenshots.
- Rule: Admin console route coverage must prove backend menu API, DB snapshot, DOM route text, and screenshot evidence from real sidebar row clicks.
- Upgrade: agents-memory
