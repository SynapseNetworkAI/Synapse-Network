"use client";

type PageMode = "overview" | "api" | "mcp" | "chatgptMcp";
type FaqItem = [string, string];

interface StructuredDataProps {
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

export function AiAgentPaymentsStructuredData({
  mode,
  title,
  description,
  docsUrl,
  faqItems,
}: Readonly<StructuredDataProps>) {
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
