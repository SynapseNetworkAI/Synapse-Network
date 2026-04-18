// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EndpointPage from "@/app/docs/api-reference/[id]/page";
import ApiReferencePage from "@/app/docs/api-reference/page";
import { ALL_ROUTES } from "@/app/docs/api-reference/endpoint-data";
import { DocsNavigationFeedbackProvider } from "@/app/docs/DocsNavigationFeedback";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/docs/api-reference",
}));

vi.mock("@/app/docs/use-active-section", () => ({
  useActiveSection: vi.fn(),
}));

function renderDocs(ui: ReactElement) {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, "en");
  return render(
    createElement(
      LanguageProvider,
      null,
      createElement(
        DocsNavigationFeedbackProvider,
        null,
        ui,
      ),
    ),
  );
}

describe("docs API reference", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    globalThis.localStorage.clear();
  });

  it("renders endpoint cards that link to detail pages", async () => {
    renderDocs(createElement(ApiReferencePage));

    expect(await screen.findByRole("heading", { name: "REST API" })).toBeTruthy();
    const endpointLinks = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href?.startsWith("/docs/api-reference/")));

    expect(endpointLinks.length).toBeGreaterThan(0);
    for (const href of endpointLinks) {
      expect(ALL_ROUTES.some((route) => href === `/docs/api-reference/${route.id}`)).toBe(true);
    }
  });

  it("renders representative endpoint detail pages with method, path, auth, examples, and errors", () => {
    const representativeRoutes = [
      ALL_ROUTES.find((route) => route.id === "get-challenge"),
      ALL_ROUTES.find((route) => route.id === "post-agent-invoke"),
      ALL_ROUTES.find((route) => route.id === "delete-credential"),
    ].filter((route): route is (typeof ALL_ROUTES)[number] => Boolean(route));

    for (const route of representativeRoutes) {
      cleanup();
      renderDocs(createElement(EndpointPage, { params: { id: route.id } }));

      expect(screen.getByRole("heading", { name: route.summary })).toBeTruthy();
      expect(screen.getAllByText(route.method).length).toBeGreaterThan(0);
      expect(screen.getAllByText(route.path).length).toBeGreaterThan(0);
      expect(screen.getByText(route.description)).toBeTruthy();
      expect(screen.getAllByText("Agent Context").length).toBeGreaterThan(0);

      if (route.auth !== "none") {
        expect(screen.getByText("Authorizations")).toBeTruthy();
      }
      if (route.bodyExample) {
        expect(screen.getByText("Request Body")).toBeTruthy();
      }
      if (route.errors && route.errors.length > 0) {
        expect(screen.getByText("Error Codes")).toBeTruthy();
        expect(screen.getByText(route.errors[0].code)).toBeTruthy();
      }
      if (route.responseExample) {
        expect(screen.getAllByText("200").length).toBeGreaterThan(0);
      }
    }
  });
});
