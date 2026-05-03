import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getTransactionExplorerBaseUrl,
  getTransactionExplorerUrl,
} from "./explorer";

describe("transaction explorer links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses local Otterscan explorer in local by default", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "local");

    expect(getTransactionExplorerBaseUrl()).toBe("http://localhost:5100");
    expect(getTransactionExplorerUrl("0xabc")).toBe(
      "http://localhost:5100/tx/0xabc"
    );
  });

  it("uses Arbitrum Sepolia explorer in staging", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");

    expect(getTransactionExplorerUrl("0xabc")).toBe(
      "https://sepolia.arbiscan.io/tx/0xabc"
    );
  });

  it("uses Arbitrum One explorer in production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "prod");

    expect(getTransactionExplorerUrl("0xabc")).toBe(
      "https://arbiscan.io/tx/0xabc"
    );
  });

  it("allows an explicit explorer base override", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "local");
    vi.stubEnv(
      "NEXT_PUBLIC_TX_EXPLORER_BASE_URL",
      "http://127.0.0.1:8545/explorer/"
    );

    expect(getTransactionExplorerUrl("0xabc")).toBe(
      "http://127.0.0.1:8545/explorer/tx/0xabc"
    );
  });
});
