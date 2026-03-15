"use client";

import * as React from "react";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { hardhat, sepolia, baseSepolia, arbitrumSepolia } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";

const chains = [hardhat, sepolia, baseSepolia, arbitrumSepolia] as const;
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ||
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  "";

const config = walletConnectProjectId
  ? getDefaultConfig({
      appName: "Synapse Network Dashboard",
      projectId: walletConnectProjectId,
      chains,
      ssr: false,
    })
  : createConfig({
      chains,
      ssr: false,
      connectors: [injected()],
      transports: {
        [hardhat.id]: http(),
        [sepolia.id]: http(),
        [baseSepolia.id]: http(),
        [arbitrumSepolia.id]: http(),
      },
    });

const queryClient = new QueryClient();

// 核心修复：防止 WalletConnect 的底层依赖(idb-keyval) 在 Next.js 服务端预渲染时因找不到浏览器环境的 indexedDB 报错崩溃
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (globalThis.window === undefined && (globalThis as any).indexedDB === undefined) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = {
    open: () => ({
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IDBKeyRange = {
    bound: () => ({}),
    lowerBound: () => ({}),
    upperBound: () => ({}),
    only: () => ({})
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMException = class DOMException extends Error {};
}

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);

    if (!walletConnectProjectId) {
      console.warn(
        "[Reown Config] Missing NEXT_PUBLIC_REOWN_PROJECT_ID/NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. WalletConnect disabled; using injected wallet connector only."
      );
    }

    // 拦截全局的 Promise 报错，过滤掉来自钱包插件(MetaMask)静默重连失败的幽灵报错
    // 防止触发 Next.js 的红底全屏崩溃页面
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = event.reason?.message || event.reason?.toString() || "";
      if (reasonStr.includes("MetaMask") || reasonStr.includes("Failed to connect")) {
        console.warn("Ignored browser wallet extension connection error.");
        event.preventDefault(); // 核心：阻止 Next.js 捕获并渲染这个错误
      }
    };

    globalThis.window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => globalThis.window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({
          accentColor: "#7b3fe4",
          accentColorForeground: "white",
          borderRadius: "medium",
        })}>
          {mounted && children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}