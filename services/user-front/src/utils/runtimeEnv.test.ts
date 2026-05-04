import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRpcUrlForChain,
  getRuntimeEnvironmentConfig,
  normalizeAppEnvironment,
} from "./runtimeEnv";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_ENV",
  "NEXT_PUBLIC_GATEWAY_BASE_URL",
  "NEXT_PUBLIC_DOCS_BASE_URL",
  "NEXT_PUBLIC_TX_EXPLORER_BASE_URL",
  "NEXT_PUBLIC_RPC_URL",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("runtime environment config", () => {
  it("normalizes supported app environment aliases", () => {
    expect(normalizeAppEnvironment("local")).toBe("local");
    expect(normalizeAppEnvironment("stage")).toBe("staging");
    expect(normalizeAppEnvironment("production")).toBe("prod");
    expect(normalizeAppEnvironment("unknown")).toBe("local");
  });

  it("uses local defaults for developer-facing addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "local");

    expect(getRuntimeEnvironmentConfig()).toMatchObject({
      appEnv: "local",
      gatewayBaseUrl: "http://127.0.0.1:8000",
      docsBaseUrl: "http://localhost:3100",
      txExplorerBaseUrl: "http://localhost:5100",
      rpcUrl: "http://127.0.0.1:8545",
      chainId: 31337,
      chainName: "Hardhat Local",
    });
  });

  it("uses staging defaults for public integration addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");

    expect(getRuntimeEnvironmentConfig()).toMatchObject({
      appEnv: "staging",
      gatewayBaseUrl: "https://api-staging.synapse-network.ai",
      docsBaseUrl: "https://docs-staging.synapse-network.ai",
      txExplorerBaseUrl: "https://sepolia.arbiscan.io",
      rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      chainName: "Arbitrum Sepolia",
    });
  });

  it("uses production defaults while leaving contract addresses out of frontend env", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "prod");

    expect(getRuntimeEnvironmentConfig()).toMatchObject({
      appEnv: "prod",
      gatewayBaseUrl: "https://api.synapse-network.ai",
      docsBaseUrl: "https://docs.synapse-network.ai",
      txExplorerBaseUrl: "https://arbiscan.io",
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      chainName: "Arbitrum One",
    });
  });

  it("allows explicit public URL overrides and trims trailing slashes", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_GATEWAY_BASE_URL", "https://gateway.test///");
    vi.stubEnv("NEXT_PUBLIC_DOCS_BASE_URL", "https://docs.test///");
    vi.stubEnv("NEXT_PUBLIC_TX_EXPLORER_BASE_URL", "https://scan.test///");
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "https://rpc.test///");

    expect(getRuntimeEnvironmentConfig()).toMatchObject({
      gatewayBaseUrl: "https://gateway.test",
      docsBaseUrl: "https://docs.test",
      txExplorerBaseUrl: "https://scan.test",
      rpcUrl: "https://rpc.test",
    });
  });

  it("uses the current environment RPC override for its active chain", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_RPC_URL", "https://custom-staging-rpc.test///");

    expect(getRpcUrlForChain(421614)).toBe("https://custom-staging-rpc.test");
    expect(getRpcUrlForChain(31337)).toBe("http://127.0.0.1:8545");
  });
});
