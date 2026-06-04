# Agent Lessons: codex-fix-www-sitemap-static-file

Task: Fix production www sitemap SEO asset delivery.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Public crawler assets should prefer static files over app routes

- Domain: frontend
- Severity: warning
- Trigger: A Next app route for `/sitemap.xml` returned XML in local and staging, but production Cloud Run served a zero-byte `text/html` response even though the image contained a valid `.next/server/app/sitemap.xml.body`.
- Root cause: The sitemap depended on app-route runtime/static cache behavior, adding a production-only serving risk for a crawler-critical asset.
- Fix: Serve `/sitemap.xml` from `services/user-front/public/sitemap.xml` and keep SEO checks pointed at the static file.
- Rule: For crawler and answer-engine control files such as `robots.txt`, `llms.txt`, and `sitemap.xml`, use static public assets unless the route truly needs runtime data.
- Upgrade: agents-memory
