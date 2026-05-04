export type AppEnvironment = "local" | "staging" | "prod";

export type RuntimeEnvironmentConfig = {
  appEnv: AppEnvironment;
  gatewayBaseUrl: string;
  docsBaseUrl: string;
  txExplorerBaseUrl: string;
  rpcUrl: string;
  chainId: number;
  chainName: string;
};

const DEFAULTS: Record<AppEnvironment, RuntimeEnvironmentConfig> = {
  local: {
    appEnv: "local",
    gatewayBaseUrl: "http://127.0.0.1:8000",
    docsBaseUrl: "http://localhost:3100",
    txExplorerBaseUrl: "http://localhost:5100",
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337,
    chainName: "Hardhat Local",
  },
  staging: {
    appEnv: "staging",
    gatewayBaseUrl: "https://api-staging.synapse-network.ai",
    docsBaseUrl: "https://docs-staging.synapse-network.ai",
    txExplorerBaseUrl: "https://sepolia.arbiscan.io",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    chainName: "Arbitrum Sepolia",
  },
  prod: {
    appEnv: "prod",
    gatewayBaseUrl: "https://api.synapse-network.ai",
    docsBaseUrl: "https://docs.synapse-network.ai",
    txExplorerBaseUrl: "https://arbiscan.io",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    chainId: 42161,
    chainName: "Arbitrum One",
  },
};

function trimSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function normalizeAppEnvironment(value?: string): AppEnvironment {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "staging" || normalized === "stage") return "staging";
  if (normalized === "prod" || normalized === "production") return "prod";
  return "local";
}

function optionalUrl(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? trimSlash(normalized) : fallback;
}

export function getRuntimeEnvironmentConfig(): RuntimeEnvironmentConfig {
  const appEnv = normalizeAppEnvironment(process.env.NEXT_PUBLIC_APP_ENV);
  const defaults = DEFAULTS[appEnv];
  return {
    ...defaults,
    gatewayBaseUrl: optionalUrl(
      process.env.NEXT_PUBLIC_GATEWAY_BASE_URL,
      defaults.gatewayBaseUrl
    ),
    docsBaseUrl: optionalUrl(
      process.env.NEXT_PUBLIC_DOCS_BASE_URL,
      defaults.docsBaseUrl
    ),
    txExplorerBaseUrl: optionalUrl(
      process.env.NEXT_PUBLIC_TX_EXPLORER_BASE_URL,
      defaults.txExplorerBaseUrl
    ),
    rpcUrl: optionalUrl(process.env.NEXT_PUBLIC_RPC_URL, defaults.rpcUrl),
  };
}

export function getRpcUrl(): string {
  return getRuntimeEnvironmentConfig().rpcUrl;
}

export function getRpcUrlForChain(chainId: number): string | undefined {
  const current = getRuntimeEnvironmentConfig();
  if (current.chainId === chainId) return current.rpcUrl;

  for (const config of Object.values(DEFAULTS)) {
    if (config.chainId === chainId) return config.rpcUrl;
  }
  return undefined;
}
