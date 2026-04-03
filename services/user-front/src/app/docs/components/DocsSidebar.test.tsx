// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DocsSidebar from "@/app/docs/components/DocsSidebar";

const {
  beginNavigationMock,
  prefetchMock,
  pushMock,
} = vi.hoisted(() => ({
  beginNavigationMock: vi.fn(),
  prefetchMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs",
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
          "Endpoint Spec",
          "Health Check",
          "View Earnings",
          "Withdraw USDC",
          "How Settlement Works",
          "Service Registry",
          "Agent Credentials",
          "Idempotency",
          "Auth",
          "Balance",
          "Services",
          "Agent Invocations",
          "Credentials",
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
});
