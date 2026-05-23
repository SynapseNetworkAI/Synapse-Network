import { request } from "./admin-api";

export type ContractRegistryStatus = "ok" | "warning" | "critical";

export type ContractRegistryNetwork = {
  env: "prod" | "staging" | "local";
  chainId: number;
  chainName: string;
  explorerBaseUrl: string;
  latestBlock: number | null;
  rpcStatus: "healthy" | "degraded";
  checkedAt: string;
};

export type ContractRegistryContract = {
  key: "synapseCore" | "usdc";
  label: string;
  address: string;
  expectedAddress?: string | null;
  explorerUrl: string;
  status: ContractRegistryStatus;
};

export type ContractRegistryRole = {
  key: string;
  label: string;
  address: string;
  purpose: string;
  source: "env" | "terraform" | "safe" | "kms" | "manual";
  explorerUrl: string;
  nativeBalance: string;
  usdcBalance: string;
  status: ContractRegistryStatus;
};

export type ContractRegistryCheck = {
  key: "owner" | "platformSigner" | "usdc";
  label: string;
  expected: string;
  actual: string;
  status: "ok" | "critical";
};

export type ContractRegistryBalances = {
  vaultUsdc: string;
  vaultNative: string;
  treasurySafeUsdc: string;
  treasurySafeNative: string;
  platformFeePoolUsdc: string;
  ledgerPlatformFeeUsdc: string;
  ledgerObligationUsdc: string | null;
  vaultLedgerDeltaUsdc: string | null;
};

export type ContractRegistryFeeSummary = {
  todayPlatformFeeUsdc: string;
  sevenDayPlatformFeeUsdc: string;
  thirtyDayPlatformFeeUsdc: string;
};

export type ContractAddressRegistry = {
  network: ContractRegistryNetwork;
  contracts: ContractRegistryContract[];
  roles: ContractRegistryRole[];
  contractChecks: ContractRegistryCheck[];
  balances: ContractRegistryBalances;
  feeSummary: ContractRegistryFeeSummary;
};

export async function getContractAddressRegistry(
  token: string
): Promise<ContractAddressRegistry> {
  return request<ContractAddressRegistry>("/api/admin/v1/contract-addresses");
}
