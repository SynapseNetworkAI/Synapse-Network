import type { Metadata } from "next";
import { AiAgentPaymentsLanding } from "@/components/seo/AiAgentPaymentsLanding";
import {
  AiAgentPaymentsStructuredData,
  aiAgentPaymentsStructuredDataProps,
} from "@/components/seo/AiAgentPaymentsStructuredData";

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
  return (
    <>
      <AiAgentPaymentsStructuredData
        {...aiAgentPaymentsStructuredDataProps("overview")}
      />
      <AiAgentPaymentsLanding mode="overview" />
    </>
  );
}
