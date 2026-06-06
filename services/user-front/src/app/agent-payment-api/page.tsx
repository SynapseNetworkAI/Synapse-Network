import type { Metadata } from "next";
import { AiAgentPaymentsLanding } from "@/components/seo/AiAgentPaymentsLanding";
import {
  AiAgentPaymentsStructuredData,
  aiAgentPaymentsStructuredDataProps,
} from "@/components/seo/AiAgentPaymentsStructuredData";

export const metadata: Metadata = {
  title: "Agent Payment API | SynapseNetwork",
  description:
    "Use Synapse discovery, price assertion, bounded credentials, paid invocation, and receipts to let software agents buy services.",
  alternates: {
    canonical: "/agent-payment-api",
  },
  openGraph: {
    title: "Agent Payment API | SynapseNetwork",
    description:
      "A USDC-native API flow for autonomous agents paying for APIs and LLM calls with audit-ready receipts.",
    url: "https://www.synapse-network.ai/agent-payment-api",
    type: "article",
  },
};

export default function AgentPaymentApiPage() {
  return (
    <>
      <AiAgentPaymentsStructuredData
        {...aiAgentPaymentsStructuredDataProps("api")}
      />
      <AiAgentPaymentsLanding mode="api" />
    </>
  );
}
