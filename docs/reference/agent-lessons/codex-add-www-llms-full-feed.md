# Codex Lessons: www llms-full answer-engine feed

### Lesson: Homepage feeds need both short and long answer-engine context

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: Adding `https://www.synapse-network.ai/llms-full.txt` after the short `llms.txt` feed was already live.
- Root cause: The short homepage `llms.txt` is good for navigation, but answer engines also need a stable long-form fact file with canonical claims, query answers, MCP tool names, and "do not claim" guardrails.
- Fix: Publish `public/llms-full.txt`, include it in the user-front sitemap, validate it in CI, and submit it through the IndexNow AI visibility batch after production deploy.
- Rule: Treat `llms.txt` as the directory and `llms-full.txt` as the durable citation context for answer engines.
- Upgrade: PR lesson only.
