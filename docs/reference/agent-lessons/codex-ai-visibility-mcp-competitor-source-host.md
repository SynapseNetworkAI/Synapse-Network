# Codex Lessons: AI visibility source-host feed refresh

### Lesson: keep docs and www AI feeds synchronized

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: A docs-front MCP page update passed prose review but `ci:ai-visibility-assets` failed because the same source-host fact was not present in the public `www` `llms.txt` / `llms-full.txt` feed.
- Root cause: AI visibility feed facts are split across docs-front MDX, docs-front `llms.txt`, user-front static `llms.txt`, user-front static `llms-full.txt`, and CI assertions.
- Fix: Update docs-front pages, docs-front `llms.txt` notes, user-front `public/llms.txt`, user-front `public/llms-full.txt`, and `scripts/ci/ai_visibility_feed_asset_assertions.mjs` together.
- Rule: For AI visibility work, treat docs pages and public `llms` feeds as one source-host package. Do not add a new probe fact to only one surface.
- Upgrade: PR lesson only.
