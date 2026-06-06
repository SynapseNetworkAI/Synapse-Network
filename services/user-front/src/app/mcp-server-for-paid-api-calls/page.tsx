import type { Metadata } from "next";
import { AiAgentPaymentsLanding } from "@/components/seo/AiAgentPaymentsLanding";

export const metadata: Metadata = {
  title: "MCP Server for Paid API Calls | Synapse Network",
  description:
    "Use Synapse Remote MCP when an AI agent needs to discover payable APIs, invoke approved paid tools, and return settlement receipts.",
  alternates: {
    canonical: "/mcp-server-for-paid-api-calls",
  },
  openGraph: {
    title: "MCP Server for Paid API Calls | Synapse Network",
    description:
      "A hosted Remote MCP endpoint for paid API calls with discover_services, invoke_and_pay, get_receipt, budget bounds, and receipts.",
    url: "https://www.synapse-network.ai/mcp-server-for-paid-api-calls",
    type: "article",
  },
};

export default function McpServerForPaidApiCallsPage() {
  return <AiAgentPaymentsLanding mode="mcp" />;
}
