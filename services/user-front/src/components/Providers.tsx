"use client";

import * as React from "react";
import {
  connectorsForWallets,
  RainbowKitProvider,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EIP1193Provider } from "viem";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arbitrum, arbitrumSepolia, hardhat } from "wagmi/chains";
import { getSupportedEvmInjectedProvider } from "@/utils/evmProvider";
import {
  getInjectedEthereumProvider,
  getWalletCompatibilityMessage,
} from "@/utils/walletCompatibility";
import {
  isIgnorableWalletExtensionError,
  toWalletExtensionErrorDetails,
} from "@/utils/walletExtensionErrors";
import {
  getRpcUrlForChain,
  getRuntimeEnvironmentConfig,
} from "@/utils/runtimeEnv";
import "@rainbow-me/rainbowkit/styles.css";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  "";

const appName = "Synapse Network Dashboard";
const transports = {
  [hardhat.id]: http(getRpcUrlForChain(hardhat.id)),
  [arbitrumSepolia.id]: http(getRpcUrlForChain(arbitrumSepolia.id)),
  [arbitrum.id]: http(getRpcUrlForChain(arbitrum.id)),
} as const;

const queryClient = new QueryClient();

type WalletPolyfillGlobal = {
  indexedDB?: {
    open: () => {
      onupgradeneeded: null;
      onsuccess: null;
      onerror: null;
      addEventListener: () => void;
      removeEventListener: () => void;
    };
  };
  IDBKeyRange?: {
    bound: () => object;
    lowerBound: () => object;
    upperBound: () => object;
    only: () => object;
  };
  DOMException?: new (message?: string) => Error;
};

// Prevent WalletConnect SSR crashes when browser-only indexedDB APIs are missing.
const serverGlobal = globalThis as unknown as WalletPolyfillGlobal;
if (globalThis.window === undefined && serverGlobal.indexedDB === undefined) {
  serverGlobal.indexedDB = {
    open: () => ({
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
  serverGlobal.IDBKeyRange = {
    bound: () => ({}),
    lowerBound: () => ({}),
    upperBound: () => ({}),
    only: () => ({}),
  };
  serverGlobal.DOMException = class DOMException extends Error {};
}

function getSupportedChains(
  appEnv: ReturnType<typeof getRuntimeEnvironmentConfig>["appEnv"]
) {
  switch (appEnv) {
    case "prod":
      return [arbitrum] as const;
    case "staging":
      return [arbitrumSepolia] as const;
    case "local":
    default:
      return [hardhat] as const;
  }
}

function createInjectedWalletConnector() {
  return injected({
    shimDisconnect: true,
    unstable_shimAsyncInject: 2_000,
    target: () => {
      const provider = getSupportedEvmInjectedProvider();
      if (!provider) {
        return undefined;
      }

      return {
        id: "synapse-supported-evm-wallet",
        name: "Supported EVM Wallet",
        provider: provider as unknown as EIP1193Provider,
      };
    },
  });
}

function createWalletConnectors(
  appEnv: ReturnType<typeof getRuntimeEnvironmentConfig>["appEnv"]
) {
  if (appEnv === "local" || !walletConnectProjectId) {
    return [createInjectedWalletConnector()];
  }

  return connectorsForWallets(
    [
      {
        groupName: "Recommended",
        wallets: [
          metaMaskWallet,
          rabbyWallet,
          coinbaseWallet,
          walletConnectWallet,
        ],
      },
    ],
    {
      appName,
      projectId: walletConnectProjectId,
    }
  );
}

function createWagmiConfig(
  chains:
    | readonly [typeof hardhat]
    | readonly [typeof arbitrumSepolia]
    | readonly [typeof arbitrum]
) {
  return createConfig({
    chains,
    ssr: false,
    connectors: createWalletConnectors(getRuntimeEnvironmentConfig().appEnv),
    transports,
  });
}

function warnAboutWalletConfiguration(chainId: number) {
  if (!walletConnectProjectId) {
    console.warn(
      "[Reown Config] Missing NEXT_PUBLIC_REOWN_PROJECT_ID/NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. WalletConnect disabled; using injected wallet connector only."
    );
  }

  const walletCompatibilityMessage = getWalletCompatibilityMessage({
    chainId,
    connectorId: null,
    injectedProvider: getInjectedEthereumProvider(),
  });
  if (walletCompatibilityMessage) {
    console.warn("[Wallet Compatibility]", walletCompatibilityMessage);
  }
}

function createUnhandledRejectionHandler() {
  return (event: PromiseRejectionEvent) => {
    const details = toWalletExtensionErrorDetails(event.reason);
    if (!isIgnorableWalletExtensionError(details)) {
      return;
    }

    console.warn(
      "Ignored browser wallet extension rejection.",
      details.message
    );
    event.preventDefault();
  };
}

function createWindowErrorHandler() {
  return (event: ErrorEvent) => {
    if (
      !isIgnorableWalletExtensionError({
        message: event.message,
        filename: event.filename,
        stack: event.error instanceof Error ? event.error.stack : null,
      })
    ) {
      return;
    }

    console.warn("Ignored browser wallet extension error.", event.message);
    event.preventDefault();
  };
}

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [mounted, setMounted] = React.useState(false);
  const runtimeEnv = getRuntimeEnvironmentConfig();
  const chains = React.useMemo(
    () => getSupportedChains(runtimeEnv.appEnv),
    [runtimeEnv.appEnv]
  );
  const config = React.useMemo(() => createWagmiConfig(chains), [chains]);

  React.useEffect(() => {
    setMounted(true);
    warnAboutWalletConfiguration(runtimeEnv.chainId);

    const handleUnhandledRejection = createUnhandledRejectionHandler();
    const handleWindowError = createWindowErrorHandler();

    globalThis.window.addEventListener(
      "unhandledrejection",
      handleUnhandledRejection,
      { capture: true }
    );
    globalThis.window.addEventListener("error", handleWindowError, {
      capture: true,
    });

    return () => {
      globalThis.window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
        { capture: true }
      );
      globalThis.window.removeEventListener("error", handleWindowError, {
        capture: true,
      });
    };
  }, [runtimeEnv.chainId]);

  if (!mounted) {
    return null;
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#7b3fe4",
            accentColorForeground: "white",
            borderRadius: "medium",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
