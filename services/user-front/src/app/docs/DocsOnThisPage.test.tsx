// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactElement, useEffect } from "react";

import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";
import { DocsActiveProvider, useDocsActive, type DocsPageNavItem } from "@/app/docs/active-context";
import DocsOnThisPage from "@/app/docs/components/DocsOnThisPage";

declare global {
  interface Window {
    location: Location & { hash: string };
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/docs",
}));

vi.mock("@/app/docs/use-active-section", () => ({
  useActiveSection: vi.fn(),
}));

function NavSeed({ items }: { items: DocsPageNavItem[] }) {
  const { setPageNavItems } = useDocsActive();
  useEffect(() => {
    setPageNavItems(items);
    return () => setPageNavItems([]);
  }, [items, setPageNavItems]);
  return null;
}

function renderWithProviders(ui: ReactElement, items: DocsPageNavItem[], lang: "en" | "zh" = "en") {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, lang);
  return render(
    createElement(
      LanguageProvider,
      null,
      createElement(
        DocsActiveProvider,
        null,
        createElement(NavSeed, { items }),
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
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    window.location.hash = "";
  });

  it("renders localized nav entries and highlights the first section", async () => {
    renderWithProviders(createElement("section", { id: "intro" }), [
      { id: "intro", label: "简介" },
      { id: "arch", label: "架构" },
    ], "zh");

    const nav = await screen.findByTestId("docs-on-this-page");
    expect(nav).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "简介" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "架构" }),
    ).toBeTruthy();
  });

  it("scrolls to the matching section and updates window hash when a nav item is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      createElement(
        "div",
        null,
        createElement("section", { id: "sdk", children: "SDK" }),
        createElement("section", { id: "guide", children: "Guide" }),
      ),
      [
        { id: "sdk", label: "SDK" },
        { id: "guide", label: "Guide" },
      ],
    );

    const target = (await screen.findAllByRole("button", { name: "Guide" }))[0];
    await user.click(target);

    const scrollIntoView = vi.mocked(window.HTMLElement.prototype.scrollIntoView);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#guide");
  });

  it("does not render the rail when there are no sections", async () => {
    renderWithProviders(createElement("div"), [], "en");
    await waitFor(() => {
      expect(screen.queryByTestId("docs-on-this-page")).toBeNull();
    });
  });

  it("keeps the rail sticky within the docs viewport chrome", async () => {
    renderWithProviders(createElement("section", { id: "intro" }), [
      { id: "intro", label: "Intro" },
    ]);

    const nav = (await screen.findAllByTestId("docs-on-this-page"))[0];
    expect(nav.className).toContain("sticky");
    expect(nav.className).toContain("top-[100px]");
    expect(nav.className).toContain("h-[calc(100vh-100px)]");
  });
});
