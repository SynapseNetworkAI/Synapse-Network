// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSupportedEvmInjectedProvider,
  getSupportedEvmInjectedProviderOrThrow,
  isPhantomEvmProvider,
  UNSUPPORTED_PHANTOM_EVM_WALLET_MESSAGE,
} from "@/utils/evmProvider";

describe("evmProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum;
    delete (globalThis as typeof globalThis & { phantom?: unknown }).phantom;
  });

  it("filters Phantom when it is the only injected provider", () => {
    const phantom = { isPhantom: true, request: vi.fn() };
    (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum =
      phantom;

    expect(isPhantomEvmProvider(phantom)).toBe(true);
    expect(getSupportedEvmInjectedProvider()).toBeUndefined();
  });

  it("selects a supported EVM provider from a multi-provider injection", () => {
    const phantom = { isPhantom: true, request: vi.fn() };
    const metamask = { isMetaMask: true, request: vi.fn() };
    (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum = {
      providers: [phantom, metamask],
      request: vi.fn(),
    };

    expect(getSupportedEvmInjectedProvider()).toBe(metamask);
  });

  it("throws a controlled product error when only Phantom is available", () => {
    (globalThis as typeof globalThis & { ethereum?: unknown }).ethereum = {
      isPhantom: true,
      request: vi.fn(),
    };

    expect(() => getSupportedEvmInjectedProviderOrThrow()).toThrow(
      UNSUPPORTED_PHANTOM_EVM_WALLET_MESSAGE
    );
  });
});
