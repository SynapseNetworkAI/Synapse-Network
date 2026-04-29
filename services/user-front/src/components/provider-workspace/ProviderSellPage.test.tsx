// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ProviderConsolePage from "@/components/provider-workspace/ProviderSellPage";

const {
  listApiSecretsMock,
  openConnectModalMock,
  routerPushMock,
  walletState,
} = vi.hoisted(() => ({
  listApiSecretsMock: vi.fn(),
  openConnectModalMock: vi.fn(),
  routerPushMock: vi.fn(),
  walletState: {
    address: undefined as string | undefined,
    isConnected: false,
  },
}));

const TRANSLATIONS: Record<string, string> = {
  "providerConsolePage.beforeProtocolDeductions": "Before Protocol Deductions",
  "providerConsolePage.claim": "Claim",
  "providerConsolePage.createService": "Create Service",
  "providerConsolePage.credentialsBannerAction": "Create Credentials",
  "providerConsolePage.credentialsBannerText":
    "Set up Provider Credentials before publishing a service. This only takes a minute.",
  "providerConsolePage.deduplicatedSettledCalls": "Deduplicated Settled Calls",
  "providerConsolePage.deploymentPipeline": "Deployment Pipeline (2 Steps)",
  "providerConsolePage.description":
    "Define API services, publish service definitions, wrap with SDK, and settle zero-gas billing to Synapse Vault.",
  "providerConsolePage.manageProviderCredentials":
    "Manage Provider Credentials",
  "providerConsolePage.metricActiveServices": "Active Services",
  "providerConsolePage.metricGrossEarnings": "Gross Earnings",
  "providerConsolePage.metricNetEarnings": "Net Earnings",
  "providerConsolePage.metricTotalApiCalls": "Total API Calls",
  "providerConsolePage.missingSigningSecret":
    "Create a Provider Signing Secret before publishing a service.",
  "providerConsolePage.newService": "New Service",
  "providerConsolePage.offline": "Offline",
  "providerConsolePage.online": "Online",
  "providerConsolePage.protocolFee": "Protocol Fee",
  "providerConsolePage.providerCredentialsDescription":
    "Issue Provider Signing Secrets.",
  "providerConsolePage.providerCredentialsTitle": "Provider Credentials",
  "providerConsolePage.providerNetLifetime": "Provider Net (Lifetime)",
  "providerConsolePage.publishApiServiceDescription":
    "Publish an API service definition.",
  "providerConsolePage.publishApiServiceTitle": "Publish API Service",
  "providerConsolePage.refreshConsole": "Refresh console",
  "providerConsolePage.routingTax": "Routing Tax",
  "providerConsolePage.runtimeAvailability": "Runtime Availability",
  "providerConsolePage.settlementBreakdown": "Settlement Breakdown",
  "providerConsolePage.title": "Provider Console",
  "providerConsolePage.verifySigningSecretFailed":
    "Unable to verify Provider Signing Secrets. Open Provider Credentials and retry.",
  "providerConsolePage.withdrawableConsistent": "Withdrawable Consistent",
};

vi.mock("wagmi", () => ({
  useAccount: () => walletState,
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: openConnectModalMock,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
  }),
}));

vi.mock("@/utils/serviceApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/serviceApi")>(
    "@/utils/serviceApi"
  );
  return {
    ...actual,
    listApiSecrets: listApiSecretsMock,
  };
});

vi.mock("@/hooks/useDashboardData", () => ({
  useDashboardData: () => ({
    services: [],
    providerStats: {
      netEarned: 0,
      receivable: 0,
      totalApiCalls: 0,
      totalEarned: 0,
      totalFees: 0,
      totalRoutingTax: 0,
    },
    handleRefresh: vi.fn(),
  }),
}));

describe("ProviderConsolePage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    walletState.address = undefined;
    walletState.isConnected = false;
    listApiSecretsMock.mockResolvedValue([]);
  });

  it("opens the wallet connection modal before managing provider credentials", async () => {
    const user = userEvent.setup();

    render(<ProviderConsolePage />);

    await user.click(
      screen.getByRole("button", { name: /Manage Provider Credentials/i })
    );

    expect(openConnectModalMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("navigates to provider credentials when the wallet is connected", async () => {
    const user = userEvent.setup();
    walletState.address = "0xabc";
    walletState.isConnected = true;

    render(<ProviderConsolePage />);

    await user.click(
      screen.getByRole("button", { name: /Manage Provider Credentials/i })
    );

    expect(openConnectModalMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/provider/secrets");
  });
});
