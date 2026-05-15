export const appName = "Synapse Docs";

export type AppEnvironment = "local" | "staging" | "prod";

export type EnvironmentConfig = {
  appEnv: AppEnvironment;
  docsUrl: string;
  consoleUrl: string;
  gatewayBaseUrl: string;
  chainId: string;
  chainName: string;
  asset: string;
  explorerUrl: string;
  synapseCore: string;
  token: string;
};

const RESERVED = "Reserved until production deployment evidence is complete";

function normalizeAppEnvironment(value?: string): AppEnvironment {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "staging" || normalized === "stage") return "staging";
  if (normalized === "prod" || normalized === "production") return "prod";
  return "local";
}

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function optionalUrl(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? trimSlash(normalized) : fallback;
}

const appEnv = normalizeAppEnvironment(process.env.NEXT_PUBLIC_APP_ENV);

const defaults: Record<AppEnvironment, EnvironmentConfig> = {
  local: {
    appEnv: "local",
    docsUrl: "http://localhost:3100",
    consoleUrl: "http://localhost:3000/dashboard/overview",
    gatewayBaseUrl: "http://127.0.0.1:8000",
    chainId: "31337",
    chainName: "Hardhat Local",
    asset: "MockUSDC",
    explorerUrl: "http://localhost:5100",
    synapseCore: "services/user-front/src/contract-config.json",
    token: "services/user-front/src/contract-config.json",
  },
  staging: {
    appEnv: "staging",
    docsUrl: "https://docs-staging.synapse-network.ai",
    consoleUrl: "https://staging.synapse-network.ai/dashboard/overview",
    gatewayBaseUrl: "https://api-staging.synapse-network.ai",
    chainId: "421614",
    chainName: "Arbitrum Sepolia",
    asset: "MockUSDC",
    explorerUrl: "https://sepolia.arbiscan.io",
    synapseCore: "0x0bA1dcE1Cc8d877052ab1C3CE2362830459D8FF4",
    token: "0xfad31daE42B0046aFA106BCf56ED0dDaCA4463B9",
  },
  prod: {
    appEnv: "prod",
    docsUrl: "https://docs.synapse-network.ai",
    consoleUrl: "https://synapse-network.ai/dashboard/overview",
    gatewayBaseUrl: "https://api.synapse-network.ai",
    chainId: "42161",
    chainName: "Arbitrum One",
    asset: "USDC",
    explorerUrl: "https://arbiscan.io",
    synapseCore: RESERVED,
    token: RESERVED,
  },
};

export const environmentRows = Object.values(defaults);

export const environmentConfig: EnvironmentConfig = {
  ...defaults[appEnv],
  docsUrl: optionalUrl(
    process.env.NEXT_PUBLIC_DOCS_BASE_URL,
    defaults[appEnv].docsUrl
  ),
  consoleUrl: optionalUrl(
    process.env.NEXT_PUBLIC_CONSOLE_BASE_URL,
    defaults[appEnv].consoleUrl
  ),
  gatewayBaseUrl: optionalUrl(
    process.env.NEXT_PUBLIC_GATEWAY_BASE_URL,
    defaults[appEnv].gatewayBaseUrl
  ),
};

export const siteUrl = environmentConfig.docsUrl;

export const consoleUrl = environmentConfig.consoleUrl;

export const gatewayBaseUrl = environmentConfig.gatewayBaseUrl;

export const docsRoute = "";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "SynapseNetworkAI",
  repo: "Synapse-Network-Docs",
  branch: "main",
};
