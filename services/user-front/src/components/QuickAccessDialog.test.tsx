// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import QuickAccessDialog from "@/components/QuickAccessDialog";

const { pushMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  pathnameMock: vi.fn(() => "/dashboard/overview"),
}));

const TRANSLATIONS: Record<string, string> = {
  "sidebar.overview": "总览",
  "sidebar.agents": "Agents",
  "sidebar.discovery": "服务发现",
  "sidebar.invocations": "调用记录",
  "sidebar.credits": "Credits",
  "sidebar.payments": "Payments",
  "sidebar.riskAudit": "Risk & Audit",
  "sidebar.developerResources": "Developer Resources",
  "sidebar.settings": "Settings",
  "sidebar.providerConsole": "Provider Console",
  "sidebar.providerCredentials": "Provider Credentials",
  "sidebar.myServices": "My Services",
  "sidebar.usageAnalytics": "Usage Analytics",
  "sidebar.withdraw": "Withdraw",
  "nav.about": "About",
  "nav.apiMarketplace": "Marketplace",
  "nav.blog": "Blog",
  "nav.quickAccess": "Quick Access",
  "nav.quickAccessAccountSettingsDescription": "Manage account settings.",
  "nav.quickAccessAgentsDescription": "Create and rotate agent runtime identities.",
  "nav.quickAccessAuditDescription": "Review risk and audit activity.",
  "nav.quickAccessBlogDescription": "Read product updates.",
  "nav.quickAccessCreditsDescription": "Recharge owner balances and vouchers.",
  "nav.quickAccessDeveloperDescription": "Open developer resources.",
  "nav.quickAccessDiscoveryDescription": "查看可用服务和路由健康状态。",
  "nav.quickAccessEmpty": "No routes found.",
  "nav.quickAccessHint": "Jump to workspace, billing, or provider pages.",
  "nav.quickAccessInvocationsDescription": "Review paid calls and request traces.",
  "nav.quickAccessMarketplaceDescription": "Browse public callable services.",
  "nav.quickAccessOverviewDescription": "View workspace status and balances.",
  "nav.quickAccessPaymentsDescription": "Review billing and payment records.",
  "nav.quickAccessProviderConsoleDescription": "Open the provider console.",
  "nav.quickAccessProviderCredentialsDescription": "Manage provider credentials.",
  "nav.quickAccessServicesDescription": "Manage provider services.",
  "nav.quickAccessSettlementsDescription": "Withdraw provider earnings.",
  "nav.quickAccessUsageDescription": "Review provider usage analytics.",
  "nav.searchPlaceholder": "Search routes, billing, services, or docs",
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
  }),
}));

describe("QuickAccessDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue("/dashboard/overview");

    vi.stubGlobal(
      "requestAnimationFrame",
      ((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      }) as typeof requestAnimationFrame,
    );

    vi.stubGlobal("cancelAnimationFrame", vi.fn() as typeof cancelAnimationFrame);
  });

  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  it("navigates to Credits when a search result is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<QuickAccessDialog open onClose={onClose} />);

    await user.type(await screen.findByPlaceholderText("Search routes, billing, services, or docs"), "Credits");
    await user.click(await screen.findByRole("button", { name: /Credits/i }));

    expect(pushMock).toHaveBeenCalledWith("/dashboard/billing/credits");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("supports Chinese search text and navigates to service discovery", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<QuickAccessDialog open onClose={onClose} />);

    await user.type(await screen.findByPlaceholderText("Search routes, billing, services, or docs"), "服务");
    await user.click(await screen.findByRole("button", { name: /服务发现/i }));

    expect(pushMock).toHaveBeenCalledWith("/dashboard/discovery");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("presses Enter to activate the highlighted result", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<QuickAccessDialog open onClose={onClose} />);

    const input = await screen.findByPlaceholderText("Search routes, billing, services, or docs");
    await user.type(input, "Payments");
    await user.keyboard("{Enter}");

    expect(pushMock).toHaveBeenCalledWith("/dashboard/billing");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes without navigation when the active page result is selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    pathnameMock.mockReturnValue("/dashboard/billing/credits");

    render(<QuickAccessDialog open onClose={onClose} />);

    await user.type(await screen.findByPlaceholderText("Search routes, billing, services, or docs"), "Credits");
    await user.click(await screen.findByRole("button", { name: /Credits/i }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without navigation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<QuickAccessDialog open onClose={onClose} />);
    await screen.findByPlaceholderText("Search routes, billing, services, or docs");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(pushMock).not.toHaveBeenCalled();
  });
});
