# Codex Lessons: AI visibility owned disambiguation refresh

### Lesson: Commit explicit collision corrections after probe evidence

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: ChatGPT mentioned SynapseNetwork for a paid MCP query but cited `python-docs.synapse.org` and described dataset search/entity metadata behavior.
- Root cause: Existing owned docs mentioned the collision domain but did not explicitly reject the dataset-search answer shape as Sage Bionetworks Synapse.
- Fix: Add a direct correction block to the brand disambiguation page, paid MCP guide, docs `llms.txt`, and www `llms.txt` / `llms-full.txt`.
- Rule: When an answer-engine probe cites a collision source while mentioning SynapseNetwork, add the exact wrong answer pattern to owned machine-readable feeds before rerunning external probes.
- Upgrade: PR lesson only.
