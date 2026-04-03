// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactElement } from "react";

import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import { DocsActiveProvider } from "@/app/docs/active-context";
import DocsOnThisPage from "@/app/docs/components/DocsOnThisPage";
import DocsOverviewPage from "@/app/docs/page";
import ConsumerGuidePage from "@/app/docs/getting-started/consumer/page";
import ProviderGuidePage from "@/app/docs/getting-started/provider/page";
import ConceptsPage from "@/app/docs/concepts/page";
import ApiReferencePage from "@/app/docs/api-reference/page";
import ContractsPage from "@/app/docs/contracts/page";
import SdkPage from "@/app/docs/sdk/page";
import PythonSdkPage from "@/app/docs/sdk/python/page";
import GettingStartedOverviewPage from "@/app/docs/getting-started/page";
import TypeScriptSdkPage from "@/app/docs/sdk/typescript/page";

const { pushMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  pathnameMock: vi.fn(() => "/docs"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    prefetch: vi.fn(),
  }),
  usePathname: () => pathnameMock(),
}));

vi.mock("@/app/docs/use-active-section", () => ({
  useActiveSection: vi.fn(),
}));

function renderWithProviders(ui: ReactElement, lang: "en" | "zh" = "en") {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, lang);
  return render(
    createElement(
      LanguageProvider,
      null,
      createElement(
        DocsActiveProvider,
        null,
        createElement("div", null, ui, createElement(DocsOnThisPage)),
      ),
    ),
  );
}

describe("Docs On this page navigation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    pathnameMock.mockReturnValue("/docs");
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it.each([
    ["/docs", createElement(DocsOverviewPage), "Introduction"],
    ["/docs/getting-started/consumer", createElement(ConsumerGuidePage), "Connect wallet and get a JWT"],
    ["/docs/getting-started/provider", createElement(ProviderGuidePage), "Connect wallet and get a JWT"],
    ["/docs/concepts", createElement(ConceptsPage), "How Settlement Works"],
    ["/docs/api-reference", createElement(ApiReferencePage), "Auth"],
    ["/docs/contracts", createElement(ContractsPage), "SynapseCore"],
    ["/docs/sdk", createElement(SdkPage), "SDK Overview"],
    ["/docs/sdk/python", createElement(PythonSdkPage), "Python SDK"],
  ])("renders On this page for %s", async (pathname, page, expectedLabel) => {
    pathnameMock.mockReturnValue(pathname as string);
    renderWithProviders(page as ReactElement);

    const nav = (await screen.findAllByTestId("docs-on-this-page"))[0];
    expect(nav).toBeTruthy();
    expect(screen.getByRole("button", { name: expectedLabel as string })).toBeTruthy();
  });

  it.each([
    ["/docs/getting-started", createElement(GettingStartedOverviewPage)],
    ["/docs/sdk/typescript", createElement(TypeScriptSdkPage)],
  ])("does not render On this page for %s", async (pathname, page) => {
    pathnameMock.mockReturnValue(pathname as string);
    renderWithProviders(page as ReactElement);

    await waitFor(() => {
      expect(screen.queryByTestId("docs-on-this-page")).toBeNull();
    });
  });

  it("scrolls to the matching section when a nav item is clicked", async () => {
    pathnameMock.mockReturnValue("/docs/sdk/python");
    const user = userEvent.setup();
    renderWithProviders(createElement(PythonSdkPage));

    const target = (await screen.findAllByRole("button", { name: "Validate the full chain" }))[0];
    await user.click(target);

    const scrollIntoView = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#py-verify");
  });

  it("pins the On this page rail to the docs viewport chrome", async () => {
    pathnameMock.mockReturnValue("/docs/getting-started/consumer");
    renderWithProviders(createElement(ConsumerGuidePage));

    const nav = (await screen.findAllByTestId("docs-on-this-page"))[0];
    expect(nav.className).toContain("sticky");
    expect(nav.className).toContain("top-[100px]");
    expect(nav.className).toContain("h-[calc(100vh-100px)]");
  });
});
