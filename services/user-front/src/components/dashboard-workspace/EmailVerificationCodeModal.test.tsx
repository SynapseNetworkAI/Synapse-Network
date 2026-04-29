// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import EmailVerificationCodeModal from "@/components/dashboard-workspace/EmailVerificationCodeModal";

const TRANSLATIONS: Record<string, string> = {
  "accountSettingsPage.emailVerificationTitle": "Verify email",
  "accountSettingsPage.emailVerificationDescription":
    "Enter the 6-digit code sent to {{email}}.",
  "accountSettingsPage.emailVerificationCodeLabel": "Email verification code",
  "accountSettingsPage.emailVerificationCodeInvalid":
    "Enter the 6-digit verification code.",
  "accountSettingsPage.emailVerificationFailed": "Failed to verify email.",
  "accountSettingsPage.emailVerificationClose": "Close email verification",
  "accountSettingsPage.emailVerificationSubmit": "Verify email",
  "accountSettingsPage.emailVerificationVerifying": "Verifying...",
  "accountSettingsPage.emailVerificationResend": "Resend code",
  "accountSettingsPage.emailVerificationResending": "Sending...",
  "accountSettingsPage.emailVerificationResent":
    "Verification code sent again.",
  "accountSettingsPage.emailVerificationResendFailed":
    "Failed to resend verification code.",
  "accountSettingsPage.emailVerificationSendsRemaining":
    "You have {{count}} verification emails left today.",
  "accountSettingsPage.emailVerificationDailyLimit":
    "Daily email verification limit reached. Please try again tomorrow.",
};

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) => TRANSLATIONS[key] ?? key,
  }),
}));

function renderModal(
  overrides: Partial<Parameters<typeof EmailVerificationCodeModal>[0]> = {}
) {
  return render(
    <EmailVerificationCodeModal
      open
      email="owner@synapse.test"
      sendsRemaining={3}
      onClose={vi.fn()}
      onVerify={vi.fn(async () => undefined)}
      onResend={vi.fn(async () => undefined)}
      {...overrides}
    />
  );
}

describe("EmailVerificationCodeModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("normalizes codes and reports verify failures", async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn(async () => {
      throw new Error("Invalid verification code");
    });
    renderModal({ onVerify });

    await user.type(
      screen.getByLabelText("Email verification code"),
      "12a34b56"
    );
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => {
      expect(onVerify).toHaveBeenCalledWith("123456");
    });
    expect(await screen.findByText("Invalid verification code")).toBeTruthy();
  });

  it("shows resend success and failure messages", async () => {
    const user = userEvent.setup();
    const onResend = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SMTP unavailable"));
    renderModal({ onResend });

    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(
      await screen.findByText("Verification code sent again.")
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(await screen.findByText("SMTP unavailable")).toBeTruthy();
  });

  it("disables resend and shows the daily limit state", () => {
    renderModal({ sendsRemaining: 0 });

    expect(
      screen.getByText(
        "Daily email verification limit reached. Please try again tomorrow."
      )
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Resend code" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
