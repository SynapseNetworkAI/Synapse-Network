// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";

import DashboardSidebar from "@/components/dashboard/DashboardSidebar";

const {
  beginNavigationMock,
  prefetchMock,
  pushMock,
  disconnectMock,
} = vi.hoisted(() => ({
  beginNavigationMock: vi.fn(),
  prefetchMock: vi.fn(),
  pushMock: vi.fn(),
  disconnectMock: vi.fn(),
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
  "sidebar.withdraw": "Withdraw",
  "sidebar.withdrawHistory": "Withdraw History",
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
    className,
    children,
  }: {
    href: string | { pathname?: string };
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    onMouseEnter?: React.MouseEventHandler<HTMLAnchorElement>;
    onFocus?: React.FocusEventHandler<HTMLAnchorElement>;
    className?: string;
    children?: React.ReactNode;
  }) => (
    <a
      href={typeof href === "string" ? href : href?.pathname}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={className}
    >
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/agents",
  useRouter: () => ({
    push: pushMock,
    prefetch: prefetchMock,
  }),
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  useConnectModal: () => ({
    openConnectModal: vi.fn(),
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
    isConnected: true,
    isSessionAuthenticated: true,
    authorize: vi.fn(async () => true),
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

    vi.stubGlobal(
      "requestAnimationFrame",
      ((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }) as typeof requestAnimationFrame
    );

    vi.stubGlobal(
      "requestIdleCallback",
      ((callback: IdleRequestCallback) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        } as IdleDeadline);
        return 1;
      }) as typeof requestIdleCallback
    );

    vi.stubGlobal(
      "cancelIdleCallback",
      vi.fn() as typeof cancelIdleCallback
    );
  });

  it("prefetches and pushes immediately for sidebar navigation", async () => {
    const user = userEvent.setup();

    render(<DashboardSidebar />);

    const overviewLink = screen.getByRole("link", { name: /Overview/i });

    await user.hover(overviewLink);
    expect(prefetchMock).toHaveBeenCalledWith("/dashboard/overview");

    await user.click(overviewLink);

    expect(beginNavigationMock).toHaveBeenCalledWith("/dashboard/overview");
    expect(pushMock).toHaveBeenCalledWith("/dashboard/overview");
  });

  it("renders account directly after withdraw history in the main navigation flow", () => {
    render(<DashboardSidebar />);

    const withdrawHistoryLink = screen.getAllByRole("link", { name: /Withdraw History/i }).at(-1);
    const accountButton = screen.getAllByRole("button", { name: /Account/i }).at(-1);

    expect(withdrawHistoryLink).toBeTruthy();
    expect(accountButton).toBeTruthy();
    expect(
      withdrawHistoryLink!.compareDocumentPosition(accountButton!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
