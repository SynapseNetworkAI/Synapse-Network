type PageMode = "overview" | "api" | "mcp" | "chatgptMcp";
type FaqItem = [string, string];

export interface AiAgentPaymentsStructuredDataProps {
  mode: PageMode;
  title: string;
  description: string;
  docsUrl: string;
  faqItems: FaqItem[];
}

const SITE_URL = "https://www.synapse-network.ai";
const MCP_ENDPOINT = "https://mcp.synapse-network.ai/mcp";

const MODE_PATHS: Record<PageMode, string> = {
  overview: "/ai-agent-payments",
  api: "/agent-payment-api",
  mcp: "/mcp-server-for-paid-api-calls",
  chatgptMcp: "/chatgpt-mcp-app-api-payments",
};

const MODE_COPY: Record<
  PageMode,
  Pick<AiAgentPaymentsStructuredDataProps, "title" | "description" | "docsUrl">
> = {
  overview: {
    title: "AI agents can discover, invoke, and pay for APIs.",
    description:
      "Synapse is the USDC-native settlement layer for autonomous agents buying APIs, LLM calls, data, tools, and MCP services with budget guardrails and receipts.",
    docsUrl: "https://docs.synapse-network.ai/ai-agent-payments",
  },
  api: {
    title: "Agent Payment API for paid machine-to-machine calls.",
    description:
      "Use Synapse discovery, price assertion, bounded credentials, paid invocation, and receipt retrieval to let software agents buy services without a human checkout flow.",
    docsUrl: "https://docs.synapse-network.ai/ai-agent-payments/agent-payment-api",
  },
  mcp: {
    title: "MCP server for paid API calls.",
    description:
      "Use Synapse Remote MCP when ChatGPT, Claude, Grok, Codex, or another agent client needs to discover payable APIs, invoke approved paid tools, and return settlement receipts.",
    docsUrl: "https://docs.synapse-network.ai/mcp/paid-api-calls",
  },
  chatgptMcp: {
    title: "ChatGPT MCP app for API payments.",
    description:
      "Register Synapse Remote MCP as a ChatGPT custom MCP app or connector so ChatGPT can scan read-only discovery tools while keeping paid invoke_and_pay calls behind confirmation.",
    docsUrl: "https://docs.synapse-network.ai/mcp/paid-api-calls",
  },
};

const MODE_KEYWORDS: Record<PageMode, string[]> = {
  overview: [
    "AI agent payments",
    "USDC settlement",
    "Agent Credentials",
    "machine-to-machine payments",
  ],
  api: [
    "Agent Payment API",
    "paid API calls",
    "service discovery",
    "settlement receipts",
  ],
  mcp: [
    "MCP server for paid API calls",
    "Remote MCP",
    "discover_services",
    "invoke_and_pay",
    "get_receipt",
  ],
  chatgptMcp: [
    "ChatGPT MCP app",
    "API payments",
    "Remote MCP connector",
    "confirmation-gated paid invocation",
  ],
};

const FAQ_ITEMS: FaqItem[] = [
  [
    "Can an AI agent pay without seeing a credit card?",
    "Yes. The owner funds Synapse with USDC and gives the agent a limited Agent Credential. The agent spends only inside that approved boundary.",
  ],
  [
    "Does every API call use blockchain gas?",
    "No. Synapse uses on-chain collateral for the settlement boundary and off-chain Gateway charging for high-frequency API calls.",
  ],
  [
    "Can ChatGPT or Claude use this?",
    "Yes, through Synapse MCP or compatible tool integrations. Paid invocation should remain behind confirmation controls.",
  ],
  [
    "How do providers earn?",
    "Providers publish callable services, set prices, receive paid agent traffic, and withdraw matured USDC receivables.",
  ],
];

export function aiAgentPaymentsStructuredDataProps(
  mode: PageMode,
): AiAgentPaymentsStructuredDataProps {
  return {
    mode,
    ...MODE_COPY[mode],
    faqItems: FAQ_ITEMS,
  };
}

export function AiAgentPaymentsStructuredData({
  mode,
  title,
  description,
  docsUrl,
  faqItems,
}: Readonly<AiAgentPaymentsStructuredDataProps>) {
  const pageUrl = `${SITE_URL}${MODE_PATHS[mode]}`;
  const graph = [
    organizationNode(),
    webPageNode({ pageUrl, title, description, docsUrl, mode }),
    softwareApplicationNode({ pageUrl, title, description, docsUrl, mode }),
    faqPageNode({ pageUrl, faqItems }),
  ];

  return (
    <script
      type="application/ld+json"
      data-testid="ai-agent-payments-jsonld"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": graph,
        }).replace(/</g, "\\u003c"),
      }}
    />
  );
}

function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: "Synapse Network",
    legalName: "SynapseNetworkAI",
    url: SITE_URL,
    sameAs: [
      "https://github.com/SynapseNetworkAI",
      "https://github.com/SynapseNetworkAI/Synapse-Network-MCP-Server",
    ],
  };
}

function webPageNode({
  pageUrl,
  title,
  description,
  docsUrl,
  mode,
}: {
  pageUrl: string;
  title: string;
  description: string;
  docsUrl: string;
  mode: PageMode;
}) {
  return {
    "@type": "WebPage",
    "@id": `${pageUrl}#webpage`,
    url: pageUrl,
    name: title,
    description,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    about: [
      "AI agent payments",
      "paid API calls",
      "USDC settlement",
      "Remote MCP",
      "Agent Credentials",
    ],
    keywords: MODE_KEYWORDS[mode],
    primaryImageOfPage: `${SITE_URL}/icon.png`,
    relatedLink: [docsUrl, MCP_ENDPOINT],
    mainEntity: { "@id": `${pageUrl}#software` },
  };
}

function softwareApplicationNode({
  pageUrl,
  title,
  description,
  docsUrl,
  mode,
}: {
  pageUrl: string;
  title: string;
  description: string;
  docsUrl: string;
  mode: PageMode;
}) {
  return {
    "@type": "SoftwareApplication",
    "@id": `${pageUrl}#software`,
    name: title,
    applicationCategory:
      mode === "chatgptMcp" ? "AIApplication" : "DeveloperApplication",
    operatingSystem: "Web, MCP-compatible AI clients",
    description,
    url: pageUrl,
    provider: { "@id": `${SITE_URL}/#organization` },
    featureList: [
      "discover_services",
      "invoke_and_pay",
      "get_receipt",
      "Agent Credential budget isolation",
      "USDC settlement receipts",
    ],
    softwareHelp: docsUrl,
    offers: {
      "@type": "Offer",
      category: "Usage-based paid API calls",
      priceCurrency: "USDC",
    },
  };
}

function faqPageNode({
  pageUrl,
  faqItems,
}: {
  pageUrl: string;
  faqItems: FaqItem[];
}) {
  return {
    "@type": "FAQPage",
    "@id": `${pageUrl}#faq`,
    mainEntity: faqItems.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: {
        "@type": "Answer",
        text: answer,
      },
    })),
  };
}
