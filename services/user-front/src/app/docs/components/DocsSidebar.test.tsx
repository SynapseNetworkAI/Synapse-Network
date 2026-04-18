// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DocsSidebar from "@/app/docs/components/DocsSidebar";

const {
  beginNavigationMock,
  pathnameMock,
  prefetchMock,
  pushMock,
} = vi.hoisted(() => ({
  beginNavigationMock: vi.fn(),
  pathnameMock: vi.fn(() => "/docs"),
  prefetchMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({
    push: pushMock,
    prefetch: prefetchMock,
  }),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "docsPage.sidebarSoon": "SOON",
      };
      return map[key] ?? key;
    },
    tList: (key: string) => {
      const map: Record<string, string[]> = {
        "docsPage.sidebarSectionLabels": [
          "OVERVIEW",
          "GETTING STARTED",
          "CORE CONCEPTS",
          "API REFERENCE",
          "SDK",
          "SMART CONTRACTS",
          "RESOURCES",
        ],
        "docsPage.sidebarItemLabels": [
          "Introduction",
          "Architecture",
          "Overview",
          "Consumer Guide",
          "Auth",
          "Deposit USDC",
          "Discover Services",
          "Create Credential",
          "Invoke & Settle",
          "Provider Guide",
          "Register Service",
          "Provider Secret",
          "Runtime Status",
          "View Earnings",
          "Withdraw USDC",
          "How Settlement Works",
          "Service Registry",
          "Agent Credentials",
          "Idempotency",
          "Auth",
          "Balance",
          "Services",
          "Provider Operations",
          "Agent Invocations",
          "Credentials",
          "SDK Overview",
          "TypeScript SDK",
          "Python SDK",
          "SynapseCore",
          "MockUSDC (Testnet)",
          "Changelog",
          "Status Page",
          "GitHub",
        ],
      };
      return map[key] ?? [];
    },
  }),
}));

vi.mock("@/app/docs/active-context", () => ({
  useDocsActive: () => ({
    activeId: "introduction",
  }),
}));

vi.mock("@/app/docs/DocsNavigationFeedback", () => ({
  useDocsNavigationFeedback: () => ({
    beginNavigation: beginNavigationMock,
  }),
}));

describe("DocsSidebar", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    pathnameMock.mockReturnValue("/docs");

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

  it("prefetches docs routes and pushes immediately on sidebar navigation", async () => {
    const user = userEvent.setup();

    render(<DocsSidebar />);

    const consumerButton = screen.getByRole("button", { name: /Consumer Guide/i });

    await user.hover(consumerButton);
    expect(prefetchMock).toHaveBeenCalledWith("/docs/getting-started/consumer");

    await user.click(consumerButton);

    expect(beginNavigationMock).toHaveBeenCalledWith("/docs/getting-started/consumer");
    expect(pushMock).toHaveBeenCalledWith("/docs/getting-started/consumer");
  });

  it("routes Python SDK to its own page", async () => {
    const user = userEvent.setup();

    render(<DocsSidebar />);

    const pythonButton = screen.getAllByRole("button", { name: /^Python SDK$/i })[0];
    await user.click(pythonButton);

    expect(beginNavigationMock).toHaveBeenCalledWith("/docs/sdk/python");
    expect(pushMock).toHaveBeenCalledWith("/docs/sdk/python");
  });

  it("routes provider child anchors to implemented provider sections", async () => {
    const user = userEvent.setup();
    pathnameMock.mockReturnValue("/docs/getting-started");

    render(<DocsSidebar />);

    await user.click(screen.getByRole("button", { name: /^Provider Guide$/i }));
    expect(pushMock).toHaveBeenLastCalledWith("/docs/getting-started/provider");

    cleanup();
    pathnameMock.mockReturnValue("/docs/getting-started/provider");
    pushMock.mockClear();
    render(<DocsSidebar />);

    await user.click(screen.getByRole("button", { name: /Provider Secret/i }));
    expect(pushMock).toHaveBeenCalledWith("/docs/getting-started/provider#step-secret");

    await user.click(screen.getByRole("button", { name: /Runtime Status/i }));
    expect(pushMock).toHaveBeenCalledWith("/docs/getting-started/provider#step-status");
  });

  it("routes concepts idempotency back to the settlement anchor", async () => {
    const user = userEvent.setup();
    pathnameMock.mockReturnValue("/docs/concepts");
    const settlement = document.createElement("section");
    settlement.id = "settlement";
    settlement.scrollIntoView = vi.fn();
    document.body.appendChild(settlement);

    render(<DocsSidebar />);

    await user.click(screen.getByRole("button", { name: /How Settlement Works/i }));

    expect(settlement.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(pushMock).toHaveBeenCalledWith("/docs/concepts#settlement");
    settlement.remove();
  });

  it("does not navigate for soon resources", async () => {
    const user = userEvent.setup();

    render(<DocsSidebar />);

    await user.click(screen.getByRole("button", { name: /Status Page/i }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(beginNavigationMock).not.toHaveBeenCalled();
  });
});
