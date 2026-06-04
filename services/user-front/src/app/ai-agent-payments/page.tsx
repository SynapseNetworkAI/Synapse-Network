import type { Metadata } from "next";
import { AiAgentPaymentsLanding } from "@/components/seo/AiAgentPaymentsLanding";

export const metadata: Metadata = {
  title: "AI Agent Payments | SynapseNetwork",
  description:
    "Synapse lets AI agents discover, invoke, and pay for APIs, LLM calls, data, tools, and MCP services with USDC budget guardrails and receipts.",
  alternates: {
    canonical: "/ai-agent-payments",
  },
  openGraph: {
    title: "AI Agent Payments | SynapseNetwork",
    description:
      "USDC-native payment and settlement infrastructure for autonomous agents buying machine services.",
    url: "https://www.synapse-network.ai/ai-agent-payments",
    type: "article",
  },
};

export default function AiAgentPaymentsPage() {
  return <AiAgentPaymentsLanding mode="overview" />;
}
