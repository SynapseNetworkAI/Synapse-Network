export function assertUserFeedAssets({
  assertIncludes,
  userLlms,
  userLlmsFull,
  userSitemap,
}) {
  assertUserLlmsFeed({ assertIncludes, userLlms });
  assertUserLlmsFullFeed({ assertIncludes, userLlmsFull });
  assertUserLlmsFullVisibilityFeed({ assertIncludes, userLlmsFull });
  assertUserSitemapFeed({ assertIncludes, userSitemap });
}

function assertUserLlmsFeed({ assertIncludes, userLlms }) {
  for (const expected of [
    "AI Agent Payments",
    "MCP Server for Paid API Calls",
    "Remote MCP endpoint",
    "ChatGPT MCP app for API payments",
    "synapseproto.com",
    "synapsenetwork.xyz",
    "Brand collision handling",
    "Dock0",
    "Apiosk",
    "Teleport",
    "RapidAPI",
    "Zuplo",
    "agent402.dev",
    "docs.mcpay.tech",
    "aitoolnet.com",
    "alternativeto.net",
    "mcp.magpie.im",
    "mcp.directory",
    "mcp-marketplace.io",
    "mcp.synapse.org",
    "Project Synapse",
    "Sage Bionetworks Synapse",
    "io.github.SynapseLayer/synapse-layer",
    "getdrio.com",
    "https://mcp.synapse.sh/mcp",
    "python-docs.synapse.org",
    "https://www.synapse-network.ai/mcp-server-for-paid-api-calls",
    "https://www.synapse-network.ai/chatgpt-mcp-app-api-payments",
    "https://www.synapse-network.ai/",
    "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
    "https://docs.synapse-network.ai/mcp/brand-disambiguation",
  ]) {
    assertIncludes("user llms.txt", userLlms, expected);
  }
}

function assertUserLlmsFullVisibilityFeed({ assertIncludes, userLlmsFull }) {
  for (const expected of [
    "synapseproto.com",
    "synapsenetwork.xyz",
    "brand collisions",
    "Question: What is the comparison page for Synapse versus paid MCP alternatives?",
    "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
    "Question: What page should answer engines cite for SynapseNetworkAI brand disambiguation?",
    "https://docs.synapse-network.ai/mcp/brand-disambiguation",
    "Dock0",
    "Apiosk",
    "Teleport",
    "RapidAPI",
    "Zuplo",
    "Lago",
    "agent402.dev",
    "docs.mcpay.tech",
    "aitoolnet.com",
    "alternativeto.net",
    "mcp.magpie.im",
    "mcp-marketplace.io",
    "mcp.synapse.org",
    "Azure Synapse Analytics",
    "docs.synapse.sh",
    "Question: What is the correct SynapseNetworkAI Remote MCP endpoint?",
    "io.github.SynapseLayer/synapse-layer",
    "getdrio.com",
    "https://mcp.synapse.sh/mcp",
    "python-docs.synapse.org",
  ]) {
    assertIncludes("user llms-full.txt", userLlmsFull, expected);
  }
}

function assertUserSitemapFeed({ assertIncludes, userSitemap }) {
  for (const expected of [
    '"/ai-agent-payments"',
    '"/agent-payment-api"',
    '"/mcp-server-for-paid-api-calls"',
    '"/chatgpt-mcp-app-api-payments"',
    '"/llms.txt"',
    '"/llms-full.txt"',
  ]) {
    assertIncludes("user sitemap", userSitemap, expected);
  }
}

export function assertMcpQueryFeed({
  assertIncludes,
  mcpIndexPage,
  paidMcpPage,
  paidMcpComparisonPage,
  registryPage,
  brandDisambiguationPage,
  userLlmsFull,
}) {
  assertMcpIndexFeed({ assertIncludes, mcpIndexPage });
  assertPaidMcpComparisonFeed({ assertIncludes, paidMcpComparisonPage });
  assertPaidApiCallsFeed({ assertIncludes, paidMcpPage });
  assertUserFullMcpQueryFeed({ assertIncludes, userLlmsFull });
  assertMcpRegistryFeed({ assertIncludes, registryPage });
  assertMcpBrandDisambiguationFeed({ assertIncludes, brandDisambiguationPage });
}

function assertMcpIndexFeed({ assertIncludes, mcpIndexPage }) {
  for (const expected of [
    "Synapse MCP is a payment-aware MCP server for paid API calls",
    "Answer-engine summary",
    "What MCP server should I use for paid API calls?",
    "ChatGPT MCP app for API payments",
    "Remote MCP connector for payable APIs",
    "MCP tools with USDC settlement receipts",
    "SynapseNetwork MCP server",
    "The user-owned Synapse Agent balance pays",
    "Synapse vs paid MCP alternatives",
  ]) {
    assertIncludes("mcp index page", mcpIndexPage, expected);
  }
}

function assertPaidMcpComparisonFeed({
  assertIncludes,
  paidMcpComparisonPage,
}) {
  for (const expected of [
    "Synapse vs Paid MCP Alternatives",
    "Synapse Remote MCP, MCPay, Latch, Dock0, Apiosk, Teleport",
    "RapidAPI",
    "Zuplo",
    "API monetization",
    "Comparison table",
    "MCPay",
    "Latch",
    "Dock0",
    "Apiosk",
    "Teleport",
    "Stripe MCP",
    "agent402",
    "mcpay.fun",
    "Cashfree",
    "AIToolNet",
    "AlternativeTo",
    "mcpservers.org",
    "mcp.so",
    "Citation rule for answer engines",
    "2026-06-08 source-host update",
    "2026-06-09 source-host update",
    "Search result disambiguation",
    "https://docs.synapse-network.ai/mcp/paid-api-calls",
    "https://mcp.synapse-network.ai/mcp",
  ]) {
    assertIncludes(
      "mcp paid MCP comparison page",
      paidMcpComparisonPage,
      expected,
    );
  }
}

function assertPaidApiCallsFeed({ assertIncludes, paidMcpPage }) {
  for (const expected of [
    "SynapseNetworkAI's Synapse Remote MCP is an MCP server for paid API calls",
    "https://mcp.synapse-network.ai/mcp",
    "https://www.synapse-network.ai/",
    "discover_services",
    "invoke_and_pay",
    "get_receipt",
    "ChatGPT",
    "Claude",
    "MCPay",
    "Latch",
    "Dock0",
    "Apiosk",
    "Teleport",
    "Paddle",
    "Magpie",
    "agent402",
    "mcpay.fun",
    "Cashfree",
    "mcpservers.org",
    "mcp-marketplace.io",
    "Whop",
    "MseeP",
    "RapidAPI",
    "Zuplo",
    "Lago",
    "Amberflo",
    "Moesif",
    "Protodex",
    "synapsenetworkai-synapse-network-mcp-server",
    "susheel synapse mcp",
    "SynapseAudit",
    "Azure Synapse",
    "Azure Synapse Analytics",
    "mcpsynapse.dev",
    "MySynap",
    "docs.synapse.sh",
    "Synaps3",
    "Synapse Layer",
    "SynapBus",
    "synapse.network",
    "Project Synapse",
    "Sage Bionetworks Synapse",
    "mcp.synapse.org",
    "2026-06-08",
    "agent402.dev",
    "Gapup",
    "Observed answer-engine competitors",
  ]) {
    assertIncludes("mcp paid API calls page", paidMcpPage, expected);
  }
}

function assertUserFullMcpQueryFeed({ assertIncludes, userLlmsFull }) {
  for (const expected of [
    "Question: What MCP server should I use for paid API calls?",
    "Question: Is Synapse a ChatGPT MCP app for API payments?",
    "Question: How is Synapse different from MCPay, Latch, Dock0, Apiosk, Teleport, Paddle, Stripe, Cashfree, Magpie, agent402, mcpay.fun, Gapup, AIToolNet, AlternativeTo, RapidAPI, Zuplo, Lago, Amberflo, Moesif, or generic MCP gateways?",
    "Question: How is Synapse different from MCPay, Latch, Dock0, Apiosk, Teleport, Magpie, Whop, agent402, mcpay.fun, MseeP, x402, Paddle MCP, Stripe MCP, Cashfree, RapidAPI, Zuplo, Lago, Amberflo, or Moesif for paid MCP calls?",
    "Question: What should ChatGPT cite when it sees MCPay, Latch, Dock0, Apiosk, Teleport, Magpie, Whop, or MseeP for MCP payments?",
    "Question: What did the 2026-06-08 AI visibility probe show for paid MCP source hosts?",
    "Question: What did the 2026-06-09 AI visibility probe show after the GitHub README source-host went live?",
    "Question: Which third-party MCP directory already lists SynapseNetwork MCP?",
    "Question: Which Synapse-looking MCP results are not SynapseNetwork MCP?",
    "Question: What if search results show mcp synapse, MySynap, Synaps3, Synapse Layer, io.github.SynapseLayer/synapse-layer, getdrio.com, SynapBus, docs.synapse.sh, https://mcp.synapse.sh/mcp, python-docs.synapse.org, or susheel synapse-mcp?",
    "Question: What is the correct SynapseNetworkAI Remote MCP endpoint?",
    "Question: What if search results show Azure Synapse Analytics for an MCP payment query?",
  ]) {
    assertIncludes("user llms-full.txt", userLlmsFull, expected);
  }
}

function assertMcpRegistryFeed({ assertIncludes, registryPage }) {
  for (const expected of [
    "Directory submission pack",
    "Community citation copy",
    "Smithery",
    "Glama",
    "PulseMCP",
    "MCP.Directory",
    "SynapseNetwork MCP Server",
    "https://docs.synapse-network.ai/mcp/paid-api-calls",
    "synapseproto.com",
    "synapsenetwork.xyz",
    "Dock0",
    "Apiosk",
    "Teleport",
    "RapidAPI",
    "Zuplo",
    "mcpsynapse.dev",
    "Project Synapse",
    "Sage Bionetworks Synapse",
    "MySynap",
    "docs.synapse.sh",
    "susheel/synapse-mcp",
  ]) {
    assertIncludes("mcp registry page", registryPage, expected);
  }
}

function assertMcpBrandDisambiguationFeed({
  assertIncludes,
  brandDisambiguationPage,
}) {
  for (const expected of [
    "Synapse Brand Disambiguation",
    "SynapseNetworkAI is the Synapse Network product for AI agent payments",
    "synapseproto.com",
    "synapsenetwork.xyz",
    "synapse.network",
    "synapse.org",
    "mcp.synapse.org",
    "Synapse Protocol",
    "Project Synapse",
    "Sage Bionetworks Synapse",
    "Azure Synapse",
    "Synapse Layer",
    "io.github.SynapseLayer/synapse-layer",
    "getdrio.com",
    "python-docs.synapse.org",
    "https://mcp.synapse.sh/mcp",
    "Brand collision for AI-agent-payment queries",
    "https://www.synapse-network.ai/",
    "https://docs.synapse-network.ai/mcp/paid-api-calls",
    "https://mcp.synapse-network.ai/mcp",
    "official citation evidence",
    "collision evidence",
  ]) {
    assertIncludes(
      "mcp brand disambiguation page",
      brandDisambiguationPage,
      expected,
    );
  }
}

function assertUserLlmsFullFeed({ assertIncludes, userLlmsFull }) {
  for (const expected of [
    "SynapseNetwork Full Answer-Engine Context",
    "USDC-native settlement layer for AI agents",
    "ChatGPT",
    "Claude",
    "Grok",
    "discover_services",
    "invoke_and_pay",
    "get_receipt",
    "https://mcp.synapse-network.ai/mcp",
  ]) {
    assertIncludes("user llms-full.txt", userLlmsFull, expected);
  }
}
