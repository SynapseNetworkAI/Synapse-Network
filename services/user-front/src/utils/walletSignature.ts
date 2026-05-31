"use client";

import { toHex } from "viem";

export function shouldFallbackSignError(message: string): boolean {
  return (
    message.includes("getChainId") ||
    message.includes("reading 'raw'") ||
    message.includes("reading 'length'") ||
    message.includes("Cannot read properties of undefined") ||
    message.includes("unavailable while reconnecting")
  );
}

export function isWalletUnstableError(message: string): boolean {
  return (
    message.includes("Cannot read properties of undefined") ||
    message.includes("reading 'length'") ||
    message.includes("reading 'raw'")
  );
}

export async function readInjectedAccounts(): Promise<string[]> {
  const ethereum = (
    globalThis as {
      ethereum?: { request: (args: { method: string }) => Promise<unknown> };
    }
  ).ethereum;
  if (!ethereum) {
    return [];
  }

  try {
    const accounts = await ethereum.request({ method: "eth_accounts" });
    if (!Array.isArray(accounts)) {
      return [];
    }
    return accounts.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
  } catch {
    return [];
  }
}

export async function signWithInjectedProvider(
  message: string,
  walletAddress: string
): Promise<string> {
  const ethereum = (
    globalThis as {
      ethereum?: {
        request: (args: {
          method: string;
          params: unknown[];
        }) => Promise<string>;
      };
    }
  ).ethereum;
  if (!ethereum) {
    throw new Error(
      "Wallet provider unavailable. Please reconnect wallet and retry."
    );
  }

  const hexMessage = toHex(message);
  const attempts: Array<unknown[]> = [
    [hexMessage, walletAddress],
    [walletAddress, hexMessage],
    [message, walletAddress],
    [walletAddress, message],
  ];

  let lastError: unknown = null;
  for (const params of attempts) {
    try {
      const signature = await ethereum.request({
        method: "personal_sign",
        params,
      });
      if (typeof signature === "string" && signature.length > 0) {
        return signature;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error("Wallet signature failed. Please reconnect wallet and retry.")
  );
}

export async function signWalletMessage(
  challengeMessage: string,
  walletAddress: string,
  signMessageAsync: (args: { message: string }) => Promise<string>
): Promise<string> {
  try {
    return await signMessageAsync({
      message: challengeMessage,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!shouldFallbackSignError(message)) {
      throw error;
    }
    return signWithInjectedProvider(challengeMessage, walletAddress);
  }
}
