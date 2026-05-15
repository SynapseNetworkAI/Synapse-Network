# Prod Public Docs Links E2E

- Generated at: 2026-05-15T02:30:43.682Z
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
- FAIL `docs_api_reference_github` - 404 https://github.com/SynapseNetworkAI/Synapse-Network-Docs/blob/main/content/docs/api-reference.mdx
- FAIL `docs_agent_builders_github` - 404 https://github.com/SynapseNetworkAI/Synapse-Network-Docs/blob/main/content/docs/get-started/agent-builders.mdx
- FAIL `docs_api_reference_open_menu` - 200 https://docs.synapse-network.ai/api-reference
- FAIL `docs_agent_builders_open_menu` - 200 https://docs.synapse-network.ai/get-started/agent-builders
- PASS `docs_repo_root` - 200 https://github.com/SynapseNetworkAI/Synapse-Network-Docs
- PASS `sdk_repo_root` - 200 https://github.com/SynapseNetworkAI/Synapse-Network-Sdk
- PASS `gateway_health` - 200 https://api.synapse-network.ai/health
- PASS `admin_gate` - 403 https://admin.synapse-network.ai/
- PASS `admin_api_gate` - 403 https://admin-api.synapse-network.ai/

## Failed

- `docs_api_reference_github`: expected one of 200, got 404
- `docs_agent_builders_github`: expected one of 200, got 404
- `docs_api_reference_open_menu`: locator.click: Error: strict mode violation: getByRole('button', { name: 'Open' }) resolved to 2 elements:
    1) <button type="button" data-search="" aria-label="Open Search" class="inline-flex items-center justify-center text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring hover:bg-fd-accent hover:text-fd-accent-foreground p-1.5 [&_svg]:size-4.5 rounded-lg">…</button> aka getByRole('button', { name: 'Open Search' })
    2) <button type="button" data-state="closed" aria-expanded="false" aria-haspopup="dialog" aria-controls="radix-_R_9qav5u9flb_" class="inline-flex items-center justify-center rounded-md p-2 font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground px-2 py-1.5 text-xs gap-2 data-[state=open]:bg-fd-…>…</button> aka getByRole('button', { name: 'Open', exact: true })

Call log:
[2m  - waiting for getByRole('button', { name: 'Open' })[22m

- `docs_agent_builders_open_menu`: locator.click: Error: strict mode violation: getByRole('button', { name: 'Open' }) resolved to 2 elements:
    1) <button type="button" data-search="" aria-label="Open Search" class="inline-flex items-center justify-center text-sm font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring hover:bg-fd-accent hover:text-fd-accent-foreground p-1.5 [&_svg]:size-4.5 rounded-lg">…</button> aka getByRole('button', { name: 'Open Search' })
    2) <button type="button" data-state="closed" aria-expanded="false" aria-haspopup="dialog" aria-controls="radix-_R_9qav5u9flb_" class="inline-flex items-center justify-center rounded-md p-2 font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground px-2 py-1.5 text-xs gap-2 data-[state=open]:bg-fd-…>…</button> aka getByRole('button', { name: 'Open', exact: true })

Call log:
[2m  - waiting for getByRole('button', { name: 'Open' })[22m

