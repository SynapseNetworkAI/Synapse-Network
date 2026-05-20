import { describe, expect, it } from "vitest";

import {
  getWalletCompatibilityMessage,
  isArbitrumEnvironmentChainId,
  isPhantomWalletContext,
} from "@/utils/walletCompatibility";

describe("walletCompatibility", () => {
  it("marks Phantom as unsupported on Arbitrum One", () => {
    expect(
      getWalletCompatibilityMessage({
        chainId: 42161,
        connectorName: "Phantom",
      })
    ).toContain("Phantom currently does not support Arbitrum");
  });

  it("marks Phantom as unsupported on Arbitrum Sepolia", () => {
    expect(
      getWalletCompatibilityMessage({
        chainId: 421614,
        injectedProvider: { isPhantom: true },
      })
    ).toContain("MetaMask or Rabby");
  });

  it("allows MetaMask on Arbitrum", () => {
    expect(
      getWalletCompatibilityMessage({
        chainId: 42161,
        connectorName: "MetaMask",
      })
    ).toBeNull();
  });

  it("does not misclassify MetaMask when Phantom is also installed", () => {
    expect(
      getWalletCompatibilityMessage({
        chainId: 42161,
        connectorName: "MetaMask",
        injectedProvider: {
          providers: [{ isMetaMask: true }, { isPhantom: true }],
        },
      })
    ).toBeNull();
  });

  it("allows Rabby on Arbitrum", () => {
    expect(
      getWalletCompatibilityMessage({
        chainId: 42161,
        connectorName: "Rabby Wallet",
      })
    ).toBeNull();
  });

  it("detects Phantom from provider arrays", () => {
    expect(
      isPhantomWalletContext({
        chainId: 42161,
        injectedProvider: {
          providers: [{ isPhantom: true }],
        },
      })
    ).toBe(true);
  });

  it("keeps explicit Phantom connectors unsupported", () => {
    expect(
      isPhantomWalletContext({
        chainId: 42161,
        connectorId: "phantom",
        injectedProvider: {
          providers: [{ isMetaMask: true }, { isPhantom: true }],
        },
      })
    ).toBe(true);
  });

  it("recognizes Arbitrum environment chain ids only", () => {
    expect(isArbitrumEnvironmentChainId(42161)).toBe(true);
    expect(isArbitrumEnvironmentChainId(421614)).toBe(true);
    expect(isArbitrumEnvironmentChainId(1)).toBe(false);
    expect(isArbitrumEnvironmentChainId(8453)).toBe(false);
  });
});
