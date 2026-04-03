// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import { DocsNavigationFeedbackProvider } from "@/app/docs/DocsNavigationFeedback";
import ProviderGuidePage from "@/app/docs/getting-started/provider/page";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
  usePathname: () => "/docs/getting-started/provider",
}));

vi.mock("@/app/docs/use-active-section", () => ({
  useActiveSection: vi.fn(),
}));

function renderPage(lang: "en" | "zh" = "en") {
  globalThis.localStorage.setItem(I18N_STORAGE_KEY, lang);
  return render(
    createElement(
      LanguageProvider,
      null,
      createElement(DocsNavigationFeedbackProvider, null, createElement(ProviderGuidePage)),
    ),
  );
}

describe("ProviderGuidePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
  });

  it("defaults to TypeScript and switches code snippets to Python", async () => {
    const user = userEvent.setup();
    renderPage("en");

    expect(await screen.findByText(/registerProviderService/)).toBeTruthy();
    expect(screen.queryByText(/register_provider_service/)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Python SDK" }));

    expect(await screen.findByText(/register_provider_service/)).toBeTruthy();
    expect(screen.getByText(/issue_provider_secret/)).toBeTruthy();
  });

  it("renders the real provider onboarding steps", async () => {
    renderPage("en");

    expect((await screen.findAllByText("Issue a provider secret")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Verify registration status").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Track provider receivables").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Minimum fields you must supply").length).toBeGreaterThan(0);
    expect(screen.getAllByText("What to verify after registration").length).toBeGreaterThan(0);
  });
});
