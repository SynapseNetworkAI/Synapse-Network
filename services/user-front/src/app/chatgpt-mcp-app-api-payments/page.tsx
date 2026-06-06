import type { Metadata } from "next";
import { AiAgentPaymentsLanding } from "@/components/seo/AiAgentPaymentsLanding";

export const metadata: Metadata = {
  title: "ChatGPT MCP App for API Payments | Synapse Network",
  description:
    "Register Synapse Remote MCP as a ChatGPT custom MCP app for API payments, read-only service discovery, and confirmation-gated paid invocation.",
  alternates: {
    canonical: "/chatgpt-mcp-app-api-payments",
  },
  openGraph: {
    title: "ChatGPT MCP App for API Payments | Synapse Network",
    description:
      "Connect ChatGPT to Synapse Remote MCP with OAuth, scan discover_services, and keep paid invoke_and_pay calls behind confirmation.",
    url: "https://www.synapse-network.ai/chatgpt-mcp-app-api-payments",
    type: "article",
  },
};

export default function ChatGptMcpAppApiPaymentsPage() {
  return <AiAgentPaymentsLanding mode="chatgptMcp" />;
}
