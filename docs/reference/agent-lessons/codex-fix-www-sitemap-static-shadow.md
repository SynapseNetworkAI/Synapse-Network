# Codex Lessons: public sitemap shadowing

### Lesson: Do not keep a static public sitemap beside a Next sitemap route

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: Staging showed `llms-full.txt` was live, but `/sitemap.xml` still lacked it after `src/app/sitemap.ts` was updated.
- Root cause: `services/user-front/public/sitemap.xml` was served before the App Router `src/app/sitemap.ts` route, so sitemap route changes were shadowed.
- Fix: Delete the static public sitemap and add CI coverage that fails if it returns.
- Rule: User-front sitemap ownership lives in `src/app/sitemap.ts`; do not add `public/sitemap.xml`.
- Upgrade: PR lesson only.
