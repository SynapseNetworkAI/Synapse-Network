// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import FeedbackDrawer from "@/components/feedback/FeedbackDrawer";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { I18N_STORAGE_KEY } from "@/i18n/config";

const { submitFeedbackMock } = vi.hoisted(() => ({
  submitFeedbackMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/discovery",
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc0000000000000000000000000000000000000" }),
}));

vi.mock("@/utils/communityApi", async () => {
  const actual = await vi.importActual<typeof import("@/utils/communityApi")>("@/utils/communityApi");
  return {
    ...actual,
    submitFeedback: submitFeedbackMock,
  };
});

function renderDrawer() {
  return render(
    createElement(
      LanguageProvider,
      null,
      createElement(FeedbackDrawer, {
        open: true,
        onClose: vi.fn(),
        seed: {
          source: "dashboard",
          route: "/dashboard/discovery?sort=best",
          category: "provider_services",
          context: {
            serviceId: "svc-1",
            authorization: "Bearer should-not-send",
            nested: { privateKey: "0x" + "a".repeat(64) },
          },
        },
      }),
    ),
  );
}

describe("FeedbackDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(I18N_STORAGE_KEY, "en");
    submitFeedbackMock.mockResolvedValue({
      status: "success",
      feedbackId: "fbk_unit",
      redacted: true,
      message: "Feedback received.",
    });
  });

  it("submits feedback and redacts sensitive context before sending", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByPlaceholderText(/Tell us what broke/i), "Discovery service card does not open.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));

    await waitFor(() => expect(submitFeedbackMock).toHaveBeenCalledTimes(1));
    const payload = submitFeedbackMock.mock.calls[0][0];
    expect(payload.route).toBe("/dashboard/discovery?sort=best");
    expect(payload.context.serviceId).toBe("svc-1");
    expect(payload.context.authorization).toBe("[REDACTED]");
    expect(payload.context.nested.privateKey).toBe("[REDACTED]");
    expect((await screen.findByTestId("feedback-id")).textContent).toContain("fbk_unit");
  });
});
