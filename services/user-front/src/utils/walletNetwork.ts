"use client";

import type { RuntimeEnvironmentConfig } from "@/utils/runtimeEnv";

type EthereumRequester = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereumRequester(): EthereumRequester | null {
  const ethereum = (
    globalThis as typeof globalThis & {
      ethereum?: EthereumRequester;
    }
  ).ethereum;
  return ethereum ?? null;
}

function isUnknownChainError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: number; message?: string };
  return (
    candidate.code === 4902 ||
    String(candidate.message || "")
      .toLowerCase()
      .includes("unrecognized chain")
  );
}

export function isWalletChainMismatchError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("chain id does not match") ||
    normalized.includes("provided chain id for verification") ||
    normalized.includes("missing or invalid parameters")
  );
}

export async function ensureWalletOnRuntimeChain(
  runtimeEnv: RuntimeEnvironmentConfig
): Promise<void> {
  const ethereum = getEthereumRequester();
  if (!ethereum) {
    throw new Error(
      "Wallet provider unavailable. Please reconnect wallet and retry."
    );
  }

  const chainIdHex = `0x${runtimeEnv.chainId.toString(16)}`;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return;
  } catch (error) {
    if (!isUnknownChainError(error)) {
      throw error;
    }
  }

  await ethereum.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: chainIdHex,
        chainName: runtimeEnv.chainName,
        nativeCurrency: {
          name: runtimeEnv.appEnv === "local" ? "GO" : "Ether",
          symbol: runtimeEnv.appEnv === "local" ? "GO" : "ETH",
          decimals: 18,
        },
        rpcUrls: [runtimeEnv.rpcUrl],
        blockExplorerUrls: [runtimeEnv.txExplorerBaseUrl],
      },
    ],
  });
}
