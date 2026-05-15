# Prod Public Docs Links E2E

- Generated at: 2026-05-15T02:33:10.781Z
- Status: failed

## Checks

- PASS `www_home` - 200 https://www.synapse-network.ai/
- PASS `www_llms` - 200 https://www.synapse-network.ai/llms.txt
- PASS `docs_home` - 200 https://docs.synapse-network.ai/
- PASS `docs_api_reference` - 200 https://docs.synapse-network.ai/api-reference
- PASS `docs_get_started` - 200 https://docs.synapse-network.ai/get-started/agent-builders
- PASS `docs_sdks` - 200 https://docs.synapse-network.ai/sdks/typescript
- PASS `docs_smart_contracts` - 200 https://docs.synapse-network.ai/smart-contracts/synapse-core
- PASS `docs_support` - 200 https://docs.synapse-network.ai/support
- PASS `docs_api_reference_markdown` - 200 https://docs.synapse-network.ai/llms.mdx/docs/api-reference/content.md
- PASS `docs_api_reference_github` - 200 https://github.com/SynapseNetworkAI/Synapse-Network-Docs/blob/main/content/docs/api-reference.mdx
- PASS `docs_agent_builders_github` - 200 https://github.com/SynapseNetworkAI/Synapse-Network-Docs/blob/main/content/docs/get-started/agent-builders.mdx
- FAIL `docs_api_reference_open_menu` - 200 https://docs.synapse-network.ai/api-reference
- FAIL `docs_agent_builders_open_menu` - 200 https://docs.synapse-network.ai/get-started/agent-builders
- PASS `docs_repo_root` - 200 https://github.com/SynapseNetworkAI/Synapse-Network-Docs
- PASS `sdk_repo_root` - 200 https://github.com/SynapseNetworkAI/Synapse-Network-Sdk
- PASS `gateway_health` - 200 https://api.synapse-network.ai/health
- PASS `admin_gate` - 403 https://admin.synapse-network.ai/
- PASS `admin_api_gate` - 403 https://admin-api.synapse-network.ai/

## Failed

- `docs_api_reference_open_menu`: locator.getAttribute: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('link', { name: 'Open in GitHub' })[22m

- `docs_agent_builders_open_menu`: locator.getAttribute: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('link', { name: 'Open in GitHub' })[22m

