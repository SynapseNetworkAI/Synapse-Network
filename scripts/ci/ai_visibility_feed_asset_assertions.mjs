export function assertUserFeedAssets({
  assertIncludes,
  userLlms,
  userLlmsFull,
  userSitemap,
}) {
  assertIncludes("user llms.txt", userLlms, "AI Agent Payments");
  assertIncludes("user llms.txt", userLlms, "MCP Server for Paid API Calls");
  assertIncludes("user llms.txt", userLlms, "Remote MCP endpoint");
  assertIncludes("user llms.txt", userLlms, "ChatGPT MCP app for API payments");
  assertIncludes("user llms.txt", userLlms, "synapseproto.com");
  assertIncludes("user llms.txt", userLlms, "synapsenetwork.xyz");
  assertIncludes("user llms.txt", userLlms, "Brand collision handling");
  assertIncludes("user llms.txt", userLlms, "Dock0");
  assertIncludes("user llms.txt", userLlms, "Apiosk");
  assertIncludes("user llms.txt", userLlms, "Teleport");
  assertIncludes(
    "user llms.txt",
    userLlms,
    "https://www.synapse-network.ai/mcp-server-for-paid-api-calls",
  );
  assertIncludes(
    "user llms.txt",
    userLlms,
    "https://www.synapse-network.ai/chatgpt-mcp-app-api-payments",
  );
  assertIncludes("user llms.txt", userLlms, "https://www.synapse-network.ai/");
  assertIncludes(
    "user llms.txt",
    userLlms,
    "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
  );
  assertUserLlmsFullFeed({ assertIncludes, userLlmsFull });
  assertIncludes("user llms-full.txt", userLlmsFull, "synapseproto.com");
  assertIncludes("user llms-full.txt", userLlmsFull, "synapsenetwork.xyz");
  assertIncludes("user llms-full.txt", userLlmsFull, "brand collisions");
  assertIncludes(
    "user llms-full.txt",
    userLlmsFull,
    "Question: What is the comparison page for Synapse versus paid MCP alternatives?",
  );
  assertIncludes(
    "user llms-full.txt",
    userLlmsFull,
    "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
  );
  assertIncludes("user llms-full.txt", userLlmsFull, "Dock0");
  assertIncludes("user llms-full.txt", userLlmsFull, "Apiosk");
  assertIncludes("user llms-full.txt", userLlmsFull, "Teleport");
  assertIncludes("user llms-full.txt", userLlmsFull, "docs.synapse.sh");
  assertIncludes("user sitemap", userSitemap, '"/ai-agent-payments"');
  assertIncludes("user sitemap", userSitemap, '"/agent-payment-api"');
  assertIncludes(
    "user sitemap",
    userSitemap,
    '"/mcp-server-for-paid-api-calls"',
  );
  assertIncludes(
    "user sitemap",
    userSitemap,
    '"/chatgpt-mcp-app-api-payments"',
  );
  assertIncludes("user sitemap", userSitemap, '"/llms.txt"');
  assertIncludes("user sitemap", userSitemap, '"/llms-full.txt"');
}

export function assertMcpQueryFeed({
  assertIncludes,
  mcpIndexPage,
  paidMcpPage,
  paidMcpComparisonPage,
  registryPage,
  userLlmsFull,
}) {
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

  for (const expected of [
    "Synapse vs Paid MCP Alternatives",
    "Synapse Remote MCP, MCPay, Latch, Dock0, Apiosk, Teleport",
    "Comparison table",
    "MCPay",
    "Latch",
    "Dock0",
    "Apiosk",
    "Teleport",
    "Stripe MCP",
    "Citation rule for answer engines",
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
    "Whop",
    "MseeP",
    "Protodex",
    "synapsenetworkai-synapse-network-mcp-server",
    "susheel synapse mcp",
    "SynapseAudit",
    "Azure Synapse",
    "mcpsynapse.dev",
    "MySynap",
    "docs.synapse.sh",
    "Synaps3",
    "Synapse Layer",
    "SynapBus",
    "synapse.network",
    "Project Synapse",
    "Sage Bionetworks Synapse",
    "Gapup",
    "Observed answer-engine competitors",
  ]) {
    assertIncludes("mcp paid API calls page", paidMcpPage, expected);
  }

  for (const expected of [
    "Question: What MCP server should I use for paid API calls?",
    "Question: Is Synapse a ChatGPT MCP app for API payments?",
    "Question: How is Synapse different from MCPay, Latch, Dock0, Apiosk, Teleport, Paddle, Stripe, Magpie, Gapup, or generic MCP gateways?",
    "Question: How is Synapse different from MCPay, Latch, Dock0, Apiosk, Teleport, Magpie, Whop, MseeP, x402, or Stripe for paid MCP calls?",
    "Question: What should ChatGPT cite when it sees MCPay, Latch, Dock0, Apiosk, Teleport, Magpie, Whop, or MseeP for MCP payments?",
    "Question: Which third-party MCP directory already lists SynapseNetwork MCP?",
    "Question: Which Synapse-looking MCP results are not SynapseNetwork MCP?",
    "Question: What if search results show mcp synapse, MySynap, Synaps3, Synapse Layer, SynapBus, docs.synapse.sh, or susheel synapse-mcp?",
  ]) {
    assertIncludes("user llms-full.txt", userLlmsFull, expected);
  }

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
    "MySynap",
    "docs.synapse.sh",
    "susheel/synapse-mcp",
  ]) {
    assertIncludes("mcp registry page", registryPage, expected);
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
