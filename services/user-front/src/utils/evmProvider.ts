"use client";

type InjectedProviderRequestArgs = {
  method: string;
  params?: unknown;
};

export type SupportedEvmInjectedProvider = {
  request: (args: InjectedProviderRequestArgs) => Promise<unknown>;
  isCoinbaseWallet?: boolean;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
  providers?: SupportedEvmInjectedProvider[];
};

type EthereumGlobal = typeof globalThis & {
  ethereum?: SupportedEvmInjectedProvider;
  phantom?: {
    ethereum?: SupportedEvmInjectedProvider;
  };
};

export const UNSUPPORTED_PHANTOM_EVM_WALLET_MESSAGE =
  "Phantom does not support the Synapse EVM settlement network. Please use MetaMask, Rabby, Coinbase Wallet, or set Phantom Default App Wallet to Always Ask and reconnect with an EVM wallet.";

export function isPhantomEvmProvider(
  provider: SupportedEvmInjectedProvider | null | undefined
): boolean {
  if (!provider) {
    return false;
  }

  const phantomEthereum = (globalThis as EthereumGlobal).phantom?.ethereum;
  return provider.isPhantom === true || provider === phantomEthereum;
}

function getInjectedProviderCandidates(): SupportedEvmInjectedProvider[] {
  const ethereum = (globalThis as EthereumGlobal).ethereum;
  if (!ethereum) {
    return [];
  }

  const providers = Array.isArray(ethereum.providers)
    ? ethereum.providers
    : [ethereum];
  return providers.filter(Boolean);
}

export function getSupportedEvmInjectedProvider():
  | SupportedEvmInjectedProvider
  | undefined {
  const providers = getInjectedProviderCandidates().filter(
    (provider) => !isPhantomEvmProvider(provider)
  );

  return (
    providers.find((provider) => provider.isMetaMask === true) ??
    providers.find((provider) => provider.isRabby === true) ??
    providers.find((provider) => provider.isCoinbaseWallet === true) ??
    providers[0]
  );
}

export function getSupportedEvmInjectedProviderOrThrow(): SupportedEvmInjectedProvider {
  const provider = getSupportedEvmInjectedProvider();
  if (!provider) {
    throw new Error(UNSUPPORTED_PHANTOM_EVM_WALLET_MESSAGE);
  }
  return provider;
}
