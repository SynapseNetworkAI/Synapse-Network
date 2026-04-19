// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";

import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

const {
  beginNavigationMock,
  prefetchMock,
  pushMock,
  disconnectMock,
  openConnectModalMock,
  authorizeMock,
  navigationState,
  authState,
} = vi.hoisted(() => ({
  beginNavigationMock: vi.fn(),
  prefetchMock: vi.fn(),
  pushMock: vi.fn(),
  disconnectMock: vi.fn(),
  openConnectModalMock: vi.fn(),
  authorizeMock: vi.fn(async () => true),
  navigationState: {
    pathname: "/dashboard/agents",
  },
  authState: {
    isConnected: true,
    isSessionAuthenticated: true,
  },
}));

const TRANSLATIONS: Record<string, string> = {
  "sidebar.ownerControl": "Owner Control",
  "sidebar.overview": "Overview",
  "sidebar.agents": "Agents",
  "sidebar.discovery": "Discovery",
  "sidebar.invocations": "Invocations",
  "sidebar.billing": "Billing",
  "sidebar.credits": "Credits",
  "sidebar.payments": "Payments",
  "sidebar.riskAudit": "Risk & Audit",
  "sidebar.developerResources": "Developer Resources",
  "sidebar.providerRole": "Provider Role",
  "sidebar.providerConsole": "Provider Console",
  "sidebar.providerCredentials": "Provider Credentials",
  "sidebar.myServices": "My Services",
  "sidebar.usageAnalytics": "Usage Analytics",
  "sidebar.settlements": "Settlements",
  "sidebar.settlement": "Settlement",
  "sidebar.withdraw": "Withdraw",
  "sidebar.withdrawHistory": "Withdraw History",
  "sidebar.invocationRecords": "Invocation Records",
  "sidebar.account": "Account",
  "sidebar.settings": "Settings",
  "sidebar.logout": "Logout",
  "nav.walletDisconnected": "Wallet disconnected",
};

vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    onMouseEnter,
    onFocus,
    prefetch,
    className,
    children,
  }: {
    href: string | { pathname?: string };
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    onMouseEnter?: React.MouseEventHandler<HTMLAnchorElement>;
    onFocus?: React.FocusEventHandler<HTMLAnchorElement>;
    prefetch?: boolean;
    className?: string;
    children?: React.ReactNode;
  }) => {
    const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
      onClick?.(event);
      // Keep the unit test inside JSDOM; product code still uses native Link navigation.
      event.preventDefault();
    };

    return (
      <a
        href={typeof href === "string" ? href : href?.pathname}
        onClick={handleClick}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
        data-prefetch={String(prefetch)}
        className={className}
      >
        {children}
      </a>
    );
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({
    push: pushMock,
    prefetch: prefetchMock,
  }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: openConnectModalMock,
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc" }),
  useDisconnect: () => ({ disconnect: disconnectMock }),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
  },
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isConnected: authState.isConnected,
    isSessionAuthenticated: authState.isSessionAuthenticated,
    authorize: authorizeMock,
  }),
}));

vi.mock("@/components/dashboard/DashboardNavigationFeedback", () => ({
  useDashboardNavigationFeedback: () => ({
    beginNavigation: beginNavigationMock,
  }),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
  }),
}));

describe("DashboardSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.pathname = "/dashboard/agents";
    authState.isConnected = true;
    authState.isSessionAuthenticated = true;
    authorizeMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("uses native Link navigation for normal sidebar links without prefetching or router push", async () => {
    const user = userEvent.setup();

    render(<DashboardSidebar />);

    const overviewLink = screen.getByRole("link", { name: /Overview/i });
    expect(overviewLink.getAttribute("href")).toBe("/dashboard/overview");
    expect(overviewLink.getAttribute("data-prefetch")).toBe("false");

    await user.hover(overviewLink);
    expect(prefetchMock).not.toHaveBeenCalled();

    await user.click(overviewLink);

    expect(beginNavigationMock).toHaveBeenCalledWith("/dashboard/overview");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not start navigation when clicking the active route", async () => {
    const user = userEvent.setup();

    render(<DashboardSidebar />);

    await user.click(screen.getAllByRole("link", { name: /Agents/i }).at(0)!);

    expect(beginNavigationMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not intercept modified clicks", async () => {
    render(<DashboardSidebar />);

    fireEvent.click(screen.getAllByRole("link", { name: /Overview/i }).at(0)!, { metaKey: true });

    expect(beginNavigationMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps provider withdraw navigation behind wallet connection", async () => {
    const user = userEvent.setup();
    authState.isConnected = false;

    render(<DashboardSidebar />);

    const settlementButton = screen.getAllByRole("button", { name: /Settlement/i }).at(-1);
    await user.click(settlementButton!);

    const withdrawLink = screen.getAllByRole("link", { name: /^Withdraw$/i }).at(-1);
    expect(withdrawLink).toBeTruthy();
    expect(withdrawLink!.getAttribute("data-prefetch")).toBe("false");

    await user.click(withdrawLink!);

    expect(openConnectModalMock).toHaveBeenCalledTimes(1);
    expect(beginNavigationMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("pushes provider withdraw after session authorization succeeds", async () => {
    const user = userEvent.setup();
    authState.isConnected = true;
    authState.isSessionAuthenticated = false;

    render(<DashboardSidebar />);

    const settlementButton = screen.getAllByRole("button", { name: /Settlement/i }).at(-1);
    await user.click(settlementButton!);

    const withdrawLink = screen.getAllByRole("link", { name: /^Withdraw$/i }).at(-1);
    await user.click(withdrawLink!);

    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(beginNavigationMock).toHaveBeenCalledWith("/provider/withdraw");
    expect(pushMock).toHaveBeenCalledWith("/provider/withdraw");
  });

  it("renders settlement group with withdraw sub-links before account", async () => {
    const user = userEvent.setup();
    render(<DashboardSidebar />);

    const settlementButton = screen.getAllByRole("button", { name: /Settlement/i }).at(-1);
    expect(settlementButton).toBeTruthy();

    await user.click(settlementButton!);

    const invocationRecordsLink = screen.getAllByRole("link", { name: /Invocation Records/i }).at(-1);
    const accountButton = screen.getAllByRole("button", { name: /Account/i }).at(-1);

    expect(invocationRecordsLink).toBeTruthy();
    expect(accountButton).toBeTruthy();
    expect(
      invocationRecordsLink!.compareDocumentPosition(accountButton!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
