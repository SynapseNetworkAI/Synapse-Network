# Codex Lessons: llms feed sitemap coverage

### Lesson: Put both short and long LLM feeds in the public sitemap

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: `https://www.synapse-network.ai/llms-full.txt` was added to the user-front sitemap while the shorter `llms.txt` directory feed remained outside it.
- Root cause: The sitemap route tracked public page routes and the new long feed, but did not explicitly model `llms.txt` as a crawlable answer-engine asset.
- Fix: Add `/llms.txt` to the sitemap route and CI coverage so short and long feed assets stay discoverable together.
- Rule: Treat `llms.txt` and `llms-full.txt` as paired answer-engine feed URLs; if one is in sitemap/IndexNow coverage, both should be there.
- Upgrade: PR lesson only.
