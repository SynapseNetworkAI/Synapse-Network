type InjectedEthereumProvider = {
  isPhantom?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  providers?: InjectedEthereumProvider[];
};

type WalletCompatibilityContext = {
  chainId?: number | null;
  connectorName?: string | null;
  connectorId?: string | null;
  injectedProvider?: unknown;
};

const ARBITRUM_CHAIN_IDS = new Set([42161, 421614]);

function normalizeConnectorName(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeConnectorId(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function asInjectedEthereumProvider(
  provider: unknown
): InjectedEthereumProvider | null {
  if (!provider || typeof provider !== "object") {
    return null;
  }
  return provider as InjectedEthereumProvider;
}

function hasPhantomProviderFlag(
  provider: InjectedEthereumProvider | null
): boolean {
  if (!provider) {
    return false;
  }
  if (provider.isPhantom) {
    return true;
  }
  return Array.isArray(provider.providers)
    ? provider.providers.some((candidate) => hasPhantomProviderFlag(candidate))
    : false;
}

function hasSupportedInjectedProviderFlag(
  provider: InjectedEthereumProvider | null
): boolean {
  if (!provider) {
    return false;
  }
  if (provider.isMetaMask || provider.isRabby || provider.isCoinbaseWallet) {
    return true;
  }
  return Array.isArray(provider.providers)
    ? provider.providers.some((candidate) =>
        hasSupportedInjectedProviderFlag(candidate)
      )
    : false;
}

function isExplicitlySupportedConnector(
  context: WalletCompatibilityContext
): boolean {
  const connectorName = normalizeConnectorName(context.connectorName);
  const connectorId = normalizeConnectorId(context.connectorId);
  return (
    connectorName.includes("metamask") ||
    connectorName.includes("rabby") ||
    connectorName.includes("coinbase") ||
    connectorName.includes("walletconnect") ||
    connectorId.includes("metamask") ||
    connectorId.includes("rabby") ||
    connectorId.includes("coinbase") ||
    connectorId.includes("walletconnect")
  );
}

export function isArbitrumEnvironmentChainId(
  chainId: number | null | undefined
): boolean {
  return typeof chainId === "number" && ARBITRUM_CHAIN_IDS.has(chainId);
}

export function isPhantomWalletContext(
  context: WalletCompatibilityContext
): boolean {
  if (isExplicitlySupportedConnector(context)) {
    return false;
  }

  const connectorName = normalizeConnectorName(context.connectorName);
  const connectorId = normalizeConnectorId(context.connectorId);
  if (connectorName.includes("phantom")) {
    return true;
  }
  if (connectorId.includes("phantom")) {
    return true;
  }

  const provider = asInjectedEthereumProvider(context.injectedProvider);
  if (hasSupportedInjectedProviderFlag(provider)) {
    return false;
  }

  return hasPhantomProviderFlag(provider);
}

export function getInjectedEthereumProvider(): unknown | null {
  if (typeof window === "undefined") {
    return null;
  }
  return (
    (
      globalThis as typeof globalThis & {
        ethereum?: unknown;
      }
    ).ethereum ?? null
  );
}

export function getWalletCompatibilityMessage(
  context: WalletCompatibilityContext
): string | null {
  if (
    !isArbitrumEnvironmentChainId(context.chainId) ||
    !isPhantomWalletContext(context)
  ) {
    return null;
  }

  return "Phantom currently does not support Arbitrum. Please use MetaMask or Rabby for Synapse on Arbitrum.";
}
