import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppChakraProvider } from "@/components/chakra-provider";
import type { ContractAddressRegistry } from "@/services/admin-api";
import { ContractAddressesWorkspace } from "./contract-addresses-page";

const registryFixture: ContractAddressRegistry = {
  network: {
    env: "prod",
    chainId: 42161,
    chainName: "Arbitrum One",
    explorerBaseUrl: "https://arbiscan.io",
    latestBlock: 1234567,
    rpcStatus: "healthy",
    checkedAt: "2026-05-21T00:00:00Z",
  },
  contracts: [
    {
      key: "synapseCore",
      label: "SynapseCore",
      address: "0x4967d23cAbe3881f809677932Cc30c11de6957B0",
      expectedAddress: "0x4967d23cAbe3881f809677932Cc30c11de6957B0",
      explorerUrl:
        "https://arbiscan.io/address/0x4967d23cAbe3881f809677932Cc30c11de6957B0",
      status: "ok",
    },
    {
      key: "usdc",
      label: "USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      expectedAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      explorerUrl:
        "https://arbiscan.io/address/0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      status: "ok",
    },
  ],
  roles: [
    {
      key: "ledgerSigner",
      label: "Ledger deployer / Safe owner signer",
      address: "0x121a2aDbe1b7d3aA41C47058af790439897a9034",
      purpose: "Hardware wallet that signs deployments and owns the Safe.",
      source: "safe",
      explorerUrl:
        "https://arbiscan.io/address/0x121a2aDbe1b7d3aA41C47058af790439897a9034",
      nativeBalance: "1.000000",
      usdcBalance: "0.000000",
      status: "ok",
    },
    {
      key: "treasurySafe",
      label: "Treasury Safe / contract owner",
      address: "0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33",
      purpose: "Safe treasury expected to own SynapseCore.",
      source: "safe",
      explorerUrl:
        "https://arbiscan.io/address/0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33",
      nativeBalance: "0.100000",
      usdcBalance: "12.000000",
      status: "ok",
    },
    {
      key: "withdrawSigner",
      label: "KMS withdraw signer",
      address: "0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee",
      purpose:
        "KMS-derived signer expected to match SynapseCore.platformSigner().",
      source: "kms",
      explorerUrl:
        "https://arbiscan.io/address/0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee",
      nativeBalance: "0.500000",
      usdcBalance: "0.000000",
      status: "ok",
    },
    {
      key: "synapseCore",
      label: "SynapseCore",
      address: "0x4967d23cAbe3881f809677932Cc30c11de6957B0",
      purpose: "On-chain USDC vault and settlement contract.",
      source: "env",
      explorerUrl:
        "https://arbiscan.io/address/0x4967d23cAbe3881f809677932Cc30c11de6957B0",
      nativeBalance: "0.000000",
      usdcBalance: "2000.000000",
      status: "ok",
    },
    {
      key: "usdc",
      label: "Arbitrum One USDC",
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      purpose: "Official USDC token used for settlement.",
      source: "env",
      explorerUrl:
        "https://arbiscan.io/address/0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      nativeBalance: "0.000000",
      usdcBalance: "0.000000",
      status: "ok",
    },
  ],
  contractChecks: [
    {
      key: "owner",
      label: "SynapseCore.owner()",
      expected: "0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33",
      actual: "0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33",
      status: "ok",
    },
    {
      key: "platformSigner",
      label: "SynapseCore.platformSigner()",
      expected: "0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee",
      actual: "0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee",
      status: "ok",
    },
    {
      key: "usdc",
      label: "SynapseCore.usdc()",
      expected: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      actual: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      status: "ok",
    },
  ],
  balances: {
    vaultUsdc: "2000.000000",
    vaultNative: "0.000000",
    treasurySafeUsdc: "12.000000",
    treasurySafeNative: "0.100000",
    platformFeePoolUsdc: "123.000000",
    ledgerPlatformFeeUsdc: "120.000000",
    ledgerObligationUsdc: "1950.000000",
    vaultLedgerDeltaUsdc: "50.000000",
  },
  feeSummary: {
    todayPlatformFeeUsdc: "3.500000",
    sevenDayPlatformFeeUsdc: "17.000000",
    thirtyDayPlatformFeeUsdc: "53.000000",
  },
};

function renderRegistry(registry: ContractAddressRegistry): string {
  return renderToStaticMarkup(
    createElement(
      AppChakraProvider,
      null,
      createElement(ContractAddressesWorkspace, { registry })
    )
  );
}

describe("ContractAddressesWorkspace", () => {
  it("renders the production contract and custody registry", () => {
    const html = renderRegistry(registryFixture);

    expect(html).toContain("Production contracts");
    expect(html).toContain("SynapseCore");
    expect(html).toContain("Arbitrum One USDC");
    expect(html).toContain("Ledger deployer / Safe owner signer");
    expect(html).toContain("Treasury Safe / contract owner");
    expect(html).toContain("KMS withdraw signer");
    expect(html).toContain("Vault USDC");
    expect(html).toContain("Platform fee pool");
    expect(html).toContain("123.000000");
    expect(html.toLowerCase()).not.toContain("private key");
    expect(html.toLowerCase()).not.toContain("secret value");
  });

  it("renders critical mismatch and reconciliation warnings", () => {
    const registry: ContractAddressRegistry = {
      ...registryFixture,
      contractChecks: registryFixture.contractChecks.map((check) =>
        check.key === "owner"
          ? {
              ...check,
              actual: "0x9999999999999999999999999999999999999999",
              status: "critical",
            }
          : check
      ),
      balances: {
        ...registryFixture.balances,
        vaultUsdc: "100.000000",
        ledgerObligationUsdc: "1950.000000",
      },
    };

    const html = renderRegistry(registry);

    expect(html).toContain("One or more on-chain contract roles do not match");
    expect(html).toContain(
      "Vault USDC is lower than the Gateway ledger obligation"
    );
    expect(html).toContain("critical");
  });
});
