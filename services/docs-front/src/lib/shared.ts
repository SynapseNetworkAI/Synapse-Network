export const appName = "Synapse Docs";
export const siteUrl =
  process.env.NEXT_PUBLIC_DOCS_BASE_URL?.replace(/\/+$/, "") ||
  (process.env.NEXT_PUBLIC_APP_ENV === "prod"
    ? "https://docs.synapse-network.ai"
    : process.env.NEXT_PUBLIC_APP_ENV === "staging"
    ? "https://docs-staging.synapse-network.ai"
    : "http://localhost:3001");

export const consoleUrl =
  process.env.NEXT_PUBLIC_CONSOLE_BASE_URL?.replace(/\/+$/, "") ||
  (process.env.NEXT_PUBLIC_APP_ENV === "prod"
    ? "https://synapse-network.ai/dashboard/overview"
    : process.env.NEXT_PUBLIC_APP_ENV === "staging"
    ? "https://staging.synapse-network.ai/dashboard/overview"
    : "http://localhost:3000/dashboard/overview");

export const gatewayBaseUrl =
  process.env.NEXT_PUBLIC_GATEWAY_BASE_URL?.replace(/\/+$/, "") ||
  (process.env.NEXT_PUBLIC_APP_ENV === "prod"
    ? "https://api.synapse-network.ai"
    : process.env.NEXT_PUBLIC_APP_ENV === "staging"
    ? "https://api-staging.synapse-network.ai"
    : "http://127.0.0.1:8000");

export const docsRoute = "";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "SynapseNetworkAI",
  repo: "Synapse-Network",
  branch: "main",
};
