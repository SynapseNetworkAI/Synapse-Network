"use client";

import * as React from "react";
import { RainbowKitProvider, getDefaultConfig, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { hardhat, sepolia, baseSepolia, arbitrumSepolia } from "wagmi/chains";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";

const config = getDefaultConfig({
  appName: "A2A-Pay Dashboard",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "8a80cea8b6033bbbd67f6bbdbbe70054", // Use env variable, fallback to a public testing ID
  chains: [hardhat, sepolia, baseSepolia, arbitrumSepolia],
  ssr: false, // 设置为 false 才可以让 wagmi 持久化钱包连接状态到 localStorage
});

const queryClient = new QueryClient();

// 核心修复：防止 WalletConnect 的底层依赖(idb-keyval) 在 Next.js 服务端预渲染时因找不到浏览器环境的 indexedDB 报错崩溃
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof window === "undefined" && typeof global !== "undefined" && typeof (global as any).indexedDB === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).indexedDB = {
    open: () => ({
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      addEventListener: () => {},
      removeEventListener: () => {}
    })
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).IDBKeyRange = {
    bound: () => ({}),
    lowerBound: () => ({}),
    upperBound: () => ({}),
    only: () => ({})
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).DOMException = class DOMException extends Error {};
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);

    // 拦截全局的 Promise 报错，过滤掉来自钱包插件(MetaMask)静默重连失败的幽灵报错
    // 防止触发 Next.js 的红底全屏崩溃页面
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = event.reason?.message || event.reason?.toString() || "";
      if (reasonStr.includes("MetaMask") || reasonStr.includes("Failed to connect")) {
        console.warn("Ignored browser wallet extension connection error.");
        event.preventDefault(); // 核心：阻止 Next.js 捕获并渲染这个错误
      }
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection);
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