# Codex Lessons: Brand disambiguation IndexNow coverage

### Lesson: AI visibility docs pages must be asserted in IndexNow payloads

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: The production `docs.synapse-network.ai/mcp/brand-disambiguation` page was live in docs, `llms.txt`, and sitemap, but was missing from the IndexNow AI visibility submission batch.
- Root cause: The asset check verified related MCP pages in several feeds, but did not assert the brand disambiguation URL inside `scripts/seo/submit_indexnow_ai_visibility.mjs`.
- Fix: Add the brand disambiguation URL to the docs IndexNow batch and assert that exact URL in the AI visibility asset check.
- Rule: When adding an AI visibility source-host page, include it in docs navigation, `llms.txt`, sitemap, and IndexNow payload assertions in the same change.
- Upgrade: PR lesson only.
