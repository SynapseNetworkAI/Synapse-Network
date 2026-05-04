// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DashboardOverviewPage from "@/components/dashboard-workspace/DashboardOverviewPage";

const { accountState, authState, openConnectModalMock } = vi.hoisted(() => ({
  accountState: {
    isConnected: false,
    address: undefined as string | undefined,
  },
  authState: {
    isSessionAuthenticated: false,
  },
  openConnectModalMock: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "overviewPage.systemOperational": "System Operational",
  "overviewPage.controlPlaneOverview": "Control Plane Overview",
  "overviewPage.networkStatus": "Network Status",
  "overviewPage.latency": "Latency",
  "overviewPage.connectWallet": "Connect Wallet",
  "overviewPage.connectedWallet": "Connected Wallet",
  "overviewPage.operationalWorkflows": "Operational Workflows",
  "overviewPage.platformIdentityModel": "Platform Identity Model",
  "overviewPage.ownerTitle": "Owner",
  "overviewPage.ownerDescription": "Owner description",
  "overviewPage.agentTitle": "Agent",
  "overviewPage.agentDescription": "Agent description",
  "overviewPage.providerTitle": "Provider",
  "overviewPage.providerDescription": "Provider description",
  "overviewPage.platformTitle": "Platform",
  "overviewPage.platformDescription": "Platform description",
  "overviewPage.coreCapabilities": "Core Capabilities",
  "overviewPage.coreCapabilitiesDescription": "Capabilities description",
  "overviewPage.footerTagline": "Footer tagline",
  "overviewPage.footerPrivacy": "Privacy",
  "overviewPage.footerTerms": "Terms",
  "overviewPage.footerSecurity": "Security",
  "overviewPage.footerStatus": "Status",
  "overviewPage.footerSupport": "Support",
};

vi.mock("wagmi", () => ({
  useAccount: () => accountState,
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({ openConnectModal: openConnectModalMock }),
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => authState,
}));

vi.mock("@/hooks/useOwnerData", () => ({
  useOwnerData: () => ({
    isBootstrapping: false,
  }),
}));

vi.mock("@/components/loading/DashboardPageLoadingState", () => ({
  default: () => <div>Loading dashboard</div>,
}));

vi.mock("@/components/dashboard/overview/OverviewHero", () => ({
  default: () => <section>Overview hero</section>,
}));

vi.mock("@/components/dashboard/overview/WorkflowSection", () => ({
  default: () => <section>Workflow section</section>,
}));

vi.mock("@/components/dashboard/overview/CapabilityCards", () => ({
  default: () => <section>Capability cards</section>,
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
  }),
}));

describe("DashboardOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountState.isConnected = false;
    accountState.address = undefined;
    authState.isSessionAuthenticated = false;
  });

  it("shows connect wallet instead of the refresh action when disconnected", async () => {
    const user = userEvent.setup();
    const oldRefreshLabel = ["REFRESH", "DATA"].join(" ");
    render(<DashboardOverviewPage />);

    expect(screen.queryByText(oldRefreshLabel)).toBeNull();
    const connectButton = screen.getByRole("button", {
      name: /Connect Wallet/i,
    });
    await user.click(connectButton);

    expect(openConnectModalMock).toHaveBeenCalledTimes(1);
  });

  it("shows the connected wallet address instead of refresh data", () => {
    const oldRefreshLabel = ["REFRESH", "DATA"].join(" ");
    accountState.isConnected = true;
    accountState.address = "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8";

    render(<DashboardOverviewPage />);

    expect(screen.queryByText(oldRefreshLabel)).toBeNull();
    expect(screen.getByLabelText("Connected Wallet").textContent).toContain(
      "0x82f1...d6f8"
    );
  });
});
