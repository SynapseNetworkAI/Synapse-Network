import type { MetadataRoute } from "next";
import apiReference from "@/data/api-reference.json";
import { siteUrl } from "@/lib/shared";

const STATIC_ROUTES = [
  "/",
  "/get-started",
  "/get-started/agent-builders",
  "/get-started/api-providers",
  "/get-started/first-paid-invocation",
  "/ai-agent-payments",
  "/ai-agent-payments/agent-payment-api",
  "/ai-agent-payments/agent-pays-for-llm-calls",
  "/ai-agent-payments/provider-monetization",
  "/ai-agent-payments/receipts-and-budget-isolation",
  "/ai-agent-payments/synapse-vs-x402",
  "/ai-agent-payments/faq",
  "/mcp",
  "/money-flows",
  "/money-flows/deposit-usdc",
  "/money-flows/consumer-withdrawals",
  "/money-flows/provider-withdrawals",
  "/money-flows/reconciliation",
  "/pricing-and-fees",
  "/concepts/agent-settlement",
  "/concepts/budget-isolation",
  "/concepts/off-chain-charging",
  "/concepts/on-chain-withdrawal",
  "/api-reference",
  "/sdks",
  "/sdks/typescript",
  "/sdks/python",
  "/sdks/go",
  "/sdks/java",
  "/sdks/dotnet",
  "/sdks/mcp-agent-tooling",
  "/smart-contracts",
  "/smart-contracts/synapse-core",
  "/smart-contracts/usdc",
  "/smart-contracts/networks",
  "/support",
] as const;

type ChangeFrequency = NonNullable<
  MetadataRoute.Sitemap[number]["changeFrequency"]
>;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    ...STATIC_ROUTES.map((route) => ({
      url: `${siteUrl}${route === "/" ? "" : route}`,
      lastModified: now,
      changeFrequency: (route === "/"
        ? "weekly"
        : "monthly") as ChangeFrequency,
      priority: route === "/" ? 1 : 0.8,
    })),
    ...apiReference.routes.map((route) => ({
      url: `${siteUrl}/api-reference/${route.id}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.72,
    })),
  ];
}
