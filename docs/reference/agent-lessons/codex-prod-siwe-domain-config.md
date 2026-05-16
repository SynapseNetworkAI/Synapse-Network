# Agent Lessons: codex-prod-siwe-domain-config

Task: Fix production SIWE domain configuration and prevent www/apex drift.
Status: Active

## Push Review

## Lessons

### Lesson: SIWE app URL must match the browser origin exactly

- Domain: prod-config
- Severity: warning
- Trigger: Production MetaMask login showed an asset-risk warning because the Gateway SIWE challenge used `https://www.synapse-network.ai` while the user-facing origin was `https://synapse-network.ai`.
- Root cause: Cloud Run runtime drift and deploy defaults mixed `www` and apex production hosts.
- Fix: Update production runtime immediately, change the prod deploy default to the apex host, and document `PUBLIC_APP_BASE_URL=https://synapse-network.ai` in prod examples.
- Rule: Wallet login challenge domain, SIWE URI host, and browser origin must be identical per environment.
- Upgrade: agents-memory
