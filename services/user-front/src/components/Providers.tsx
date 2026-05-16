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
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  arbitrum,
  hardhat,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
} from "wagmi/chains";
import type { EIP1193Provider } from "viem";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import {
  isIgnorableWalletExtensionError,
  toWalletExtensionErrorDetails,
} from "@/utils/walletExtensionErrors";
import { getSupportedEvmInjectedProvider } from "@/utils/evmProvider";
import { getRpcUrlForChain } from "@/utils/runtimeEnv";
import "@rainbow-me/rainbowkit/styles.css";

const chains = [
  hardhat,
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  arbitrum,
] as const;
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  "";

const appName = "Synapse Network Dashboard";
const transports = {
  [hardhat.id]: http(getRpcUrlForChain(hardhat.id)),
  [sepolia.id]: http(),
  [baseSepolia.id]: http(),
  [arbitrumSepolia.id]: http(getRpcUrlForChain(arbitrumSepolia.id)),
  [arbitrum.id]: http(getRpcUrlForChain(arbitrum.id)),
};
const connectors = walletConnectProjectId
  ? connectorsForWallets(
      [
        {
          groupName: "Recommended EVM wallets",
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
    )
  : [
      injected({
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
      }),
    ];

const config = createConfig({
  chains,
  ssr: false,
  connectors,
  transports,
});

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

// 核心修复：防止 WalletConnect 的底层依赖(idb-keyval) 在 Next.js 服务端预渲染时因找不到浏览器环境的 indexedDB 报错崩溃
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

export function Providers({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);

    if (!walletConnectProjectId) {
      console.warn(
        "[Reown Config] Missing NEXT_PUBLIC_REOWN_PROJECT_ID/NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. WalletConnect disabled; using injected wallet connector only."
      );
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
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

    const handleWindowError = (event: ErrorEvent) => {
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
  }, []);

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
