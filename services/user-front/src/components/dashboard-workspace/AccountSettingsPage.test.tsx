// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AccountSettingsPage from "@/components/dashboard-workspace/AccountSettingsPage";

const {
  authorizeMock,
  getOwnerProfileMock,
  resendOwnerEmailCodeMock,
  requestOwnerProfileChallengeMock,
  updateOwnerProfileMock,
  verifyOwnerEmailCodeMock,
  signMessageAsyncMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(async () => true),
  getOwnerProfileMock: vi.fn(),
  resendOwnerEmailCodeMock: vi.fn(),
  requestOwnerProfileChallengeMock: vi.fn(),
  updateOwnerProfileMock: vi.fn(),
  verifyOwnerEmailCodeMock: vi.fn(),
  signMessageAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "accountSettingsPage.title": "Settings",
  "accountSettingsPage.description":
    "Bind operator identity to your owner wallet without adding a second account system. Name and email stay optional, but every mutation is signed by the wallet.",
  "accountSettingsPage.profileTitle": "Wallet-bound profile",
  "accountSettingsPage.profileDescription":
    "This profile is attached to your owner wallet. Save actions require a fresh wallet signature, so nobody can spoof account metadata from a stale JWT alone.",
  "accountSettingsPage.identitySummaryTitle": "Current identity",
  "accountSettingsPage.connectedWallet": "Connected wallet",
  "accountSettingsPage.notConnected": "Wallet not connected",
  "accountSettingsPage.walletCardTitle": "Wallet trust anchor",
  "accountSettingsPage.walletRowDescription":
    "This wallet remains the root identity behind every signed profile mutation.",
  "accountSettingsPage.walletSessionMissing":
    "Reconnect the wallet to unlock signed profile updates.",
  "accountSettingsPage.nameLabel": "Account name",
  "accountSettingsPage.namePlaceholder": "Synapse operator",
  "accountSettingsPage.nameHelp":
    "Shown as your operator-facing account label across the control plane.",
  "accountSettingsPage.emailLabel": "Email",
  "accountSettingsPage.emailDescription":
    "Link an operator email to this wallet address. Changing it resets verification until the next proof flow lands.",
  "accountSettingsPage.emailPlaceholder": "ops@yourcompany.com",
  "accountSettingsPage.emailHelp":
    "Email is optional. If you change it later, verification resets until the next email proof flow lands.",
  "accountSettingsPage.emailVerified":
    "Email is linked to this wallet. Verified flag is currently wallet-side only.",
  "accountSettingsPage.emailVerifiedBadge": "Verified",
  "accountSettingsPage.emailPending":
    "Verification pending for {{email}}. It will bind only after code verification.",
  "accountSettingsPage.emailChange": "Change email",
  "accountSettingsPage.emailChangeCancelEdit": "Cancel edit",
  "accountSettingsPage.emailPendingCancel": "Cancel email change",
  "accountSettingsPage.emailChangeCancelled": "Pending email change cancelled.",
  "accountSettingsPage.emailRemove": "Remove email",
  "accountSettingsPage.emailRemoveConfirm":
    "Remove this email from your Synapse account?",
  "accountSettingsPage.emailRemoved": "Email removed from this wallet.",
  "accountSettingsPage.emailVerificationSent":
    "Verification code sent. Enter it to bind this email.",
  "accountSettingsPage.emailVerificationSuccess": "Email verified and linked.",
  "accountSettingsPage.emailVerificationOpen": "Enter verification code",
  "accountSettingsPage.emailVerificationTitle": "Verify email",
  "accountSettingsPage.emailVerificationDescription":
    "Enter the 6-digit code sent to {{email}}. This email will bind only after verification.",
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
  "accountSettingsPage.emailVerificationLocked":
    "Too many incorrect codes. Request a new code to continue.",
  "accountSettingsPage.emailVerificationExpired":
    "Verification code expired. Request a new code.",
  "accountSettingsPage.invalidEmail": "Enter a valid email address.",
  "accountSettingsPage.notifyMarketingTitle": "Earning reports",
  "accountSettingsPage.notifyMarketingDescription":
    "Receive non-critical ecosystem and revenue summaries on the linked email.",
  "accountSettingsPage.notifyAlertsTitle": "Budget alerts",
  "accountSettingsPage.notifyAlertsDescription":
    "Receive high-signal notifications when credits, spend caps, or risk conditions need action.",
  "accountSettingsPage.securityTitle": "Session Security",
  "accountSettingsPage.securityDescription":
    "Your wallet remains the only root identity. JWT proves session continuity; wallet signature proves profile ownership at write time.",
  "accountSettingsPage.saveRowTitle": "Save changes",
  "accountSettingsPage.saveRowDescription":
    "Commit this profile update to the control plane with one fresh wallet signature.",
  "accountSettingsPage.saveButton": "Save settings",
  "accountSettingsPage.saving": "Saving...",
  "accountSettingsPage.saveHint":
    "Save will request one fresh wallet signature to bind this profile update to your owner address.",
  "accountSettingsPage.saveRequiresWallet":
    "Viewing can use the current session, but saving still requires the live wallet to sign the profile update.",
  "accountSettingsPage.saveSuccess": "Account settings updated.",
  "accountSettingsPage.saveFailed": "Failed to update account settings.",
  "accountSettingsPage.loadFailed": "Failed to load account settings.",
  "accountSettingsPage.authorizeFirst":
    "Wallet session missing. Please authorize with wallet first.",
  "accountSettingsPage.walletRequired":
    "Wallet session missing. Please reconnect and try again.",
  "accountSettingsPage.connectWalletToSave":
    "Reconnect the wallet to sign and save account settings.",
  "accountSettingsPage.walletReconnectRequired":
    "Wallet connection is unstable. Please reconnect and retry the save.",
  "accountSettingsPage.unset": "Unset",
  "accountSettingsPage.loading": "Loading account posture...",
};

const translate = (key: string) => TRANSLATIONS[key] ?? key;

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xAbc", isConnected: true }),
  useSignMessage: () => ({ signMessageAsync: signMessageAsyncMock }),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/components/WalletAuthGuard", () => ({
  useAuth: () => ({
    isSessionAuthenticated: true,
    isAuthorizing: false,
    authorize: authorizeMock,
  }),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: translate,
  }),
}));

vi.mock("@/utils/authSession", () => ({
  getStoredAuthSession: () => ({
    token: "jwt",
    wallet: "0xabc",
    expiresAt: Date.now() + 60_000,
  }),
}));

vi.mock("@/utils/accountProfileApi", () => ({
  getOwnerProfile: getOwnerProfileMock,
  resendOwnerEmailCode: resendOwnerEmailCodeMock,
  requestOwnerProfileChallenge: requestOwnerProfileChallengeMock,
  updateOwnerProfile: updateOwnerProfileMock,
  verifyOwnerEmailCode: verifyOwnerEmailCodeMock,
}));

vi.mock("@/utils/walletSignature", () => ({
  signWalletMessage: vi.fn(async () => "0xsigned"),
  isWalletUnstableError: (message: string) =>
    message.includes("reading 'raw'") ||
    message.includes("Connector not connected"),
}));

describe("AccountSettingsPage", () => {
  beforeEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getOwnerProfileMock.mockResolvedValue({
      ownerAddress: "0xabc",
      displayName: "Synapse Ops",
      email: "ops@synapse.test",
      emailVerified: true,
      pendingEmail: null,
      emailVerificationStatus: "none",
      emailVerificationSendsRemaining: 5,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:00:00",
    });
    requestOwnerProfileChallengeMock.mockResolvedValue(
      "Update Synapse account profile"
    );
    updateOwnerProfileMock.mockResolvedValue({
      ownerAddress: "0xabc",
      displayName: "Synapse Infra",
      email: "infra@synapse.test",
      emailVerified: false,
      pendingEmail: "infra@synapse.test",
      emailVerificationStatus: "pending",
      emailVerificationSendsRemaining: 4,
      notifyMarketing: false,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:02:00",
    });
    verifyOwnerEmailCodeMock.mockResolvedValue({
      ownerAddress: "0xabc",
      displayName: "Synapse Infra",
      email: "infra@synapse.test",
      emailVerified: true,
      pendingEmail: null,
      emailVerificationStatus: "none",
      emailVerificationSendsRemaining: 4,
      notifyMarketing: false,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:03:00",
    });
    resendOwnerEmailCodeMock.mockResolvedValue({
      ownerAddress: "0xabc",
      displayName: "Synapse Ops",
      email: "ops@synapse.test",
      emailVerified: true,
      pendingEmail: "new@synapse.test",
      emailVerificationStatus: "pending",
      emailVerificationSendsRemaining: 4,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:07:00",
    });
  });

  it("loads the owner profile and shows wallet identity summary", async () => {
    render(<AccountSettingsPage />);

    expect(await screen.findByLabelText("Account name")).toBeTruthy();
    expect(getOwnerProfileMock).toHaveBeenCalledWith("0xabc");
    expect(screen.getByText("0xabc")).toBeTruthy();
  });

  it("requests a signed challenge and updates the owner profile", async () => {
    const user = userEvent.setup();

    render(<AccountSettingsPage />);

    const nameInput = (await screen.findByLabelText(
      "Account name"
    )) as HTMLInputElement;
    await user.click(screen.getByRole("button", { name: "Change email" }));
    const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
    const marketingToggle = screen.getByRole("checkbox", {
      name: /Earning reports/i,
    });

    await user.clear(nameInput);
    await user.type(nameInput, "Synapse Infra");
    await user.clear(emailInput);
    await user.type(emailInput, "infra@synapse.test");
    await user.click(marketingToggle);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(requestOwnerProfileChallengeMock).toHaveBeenCalledWith("0xabc", {
        displayName: "Synapse Infra",
        email: "infra@synapse.test",
        notifyMarketing: false,
        notifyAlerts: true,
      });
    });
    await waitFor(() => {
      expect(updateOwnerProfileMock).toHaveBeenCalledWith("0xabc", {
        displayName: "Synapse Infra",
        email: "infra@synapse.test",
        notifyMarketing: false,
        notifyAlerts: true,
        message: "Update Synapse account profile",
        signature: "0xsigned",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Verification code sent. Enter it to bind this email."
    );
    expect(
      await screen.findByRole("dialog", { name: "Verify email" })
    ).toBeTruthy();
    expect(
      screen.getByText("You have 4 verification emails left today.")
    ).toBeTruthy();
  });

  it("verifies pending email with the modal code", async () => {
    const user = userEvent.setup();

    render(<AccountSettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Change email" })
    );
    const emailInput = (await screen.findByLabelText(
      "Email"
    )) as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, "infra@synapse.test");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const codeInput = await screen.findByLabelText("Email verification code");
    await user.type(codeInput, "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => {
      expect(verifyOwnerEmailCodeMock).toHaveBeenCalledWith("0xabc", {
        email: "infra@synapse.test",
        code: "123456",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Email verified and linked.");
  });

  it("blocks invalid email before signature request", async () => {
    const user = userEvent.setup();

    render(<AccountSettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Change email" })
    );
    const emailInput = (await screen.findByLabelText(
      "Email"
    )) as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, "bad-email");
    const saveButton = screen.getByRole("button", { name: "Save settings" });

    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(saveButton.getAttribute("disabled")).not.toBeNull();
    expect(requestOwnerProfileChallengeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("removes a verified email after wallet confirmation", async () => {
    const user = userEvent.setup();
    updateOwnerProfileMock.mockResolvedValueOnce({
      ownerAddress: "0xabc",
      displayName: "Synapse Ops",
      email: null,
      emailVerified: false,
      pendingEmail: null,
      emailVerificationStatus: "none",
      emailVerificationSendsRemaining: 5,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:04:00",
    });

    render(<AccountSettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Remove email" })
    );
    expect(
      await screen.findByText("Remove this email from your Synapse account?")
    ).toBeTruthy();
    await user.click(
      screen.getAllByRole("button", { name: "Remove email" }).at(-1)!
    );

    await waitFor(() => {
      expect(updateOwnerProfileMock).toHaveBeenCalledWith("0xabc", {
        displayName: "Synapse Ops",
        email: null,
        notifyMarketing: true,
        notifyAlerts: true,
        message: "Update Synapse account profile",
        signature: "0xsigned",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Email removed from this wallet."
    );
  });

  it("cancels a pending email change without replacing the verified email", async () => {
    const user = userEvent.setup();
    getOwnerProfileMock.mockResolvedValueOnce({
      ownerAddress: "0xabc",
      displayName: "Synapse Ops",
      email: "ops@synapse.test",
      emailVerified: true,
      pendingEmail: "new@synapse.test",
      emailVerificationStatus: "pending",
      emailVerificationSendsRemaining: 4,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:05:00",
    });
    updateOwnerProfileMock.mockResolvedValueOnce({
      ownerAddress: "0xabc",
      displayName: "Synapse Ops",
      email: "ops@synapse.test",
      emailVerified: true,
      pendingEmail: null,
      emailVerificationStatus: "none",
      emailVerificationSendsRemaining: 4,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:06:00",
    });

    render(<AccountSettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Cancel email change" })
    );

    await waitFor(() => {
      expect(updateOwnerProfileMock).toHaveBeenCalledWith("0xabc", {
        displayName: "Synapse Ops",
        email: "ops@synapse.test",
        notifyMarketing: true,
        notifyAlerts: true,
        message: "Update Synapse account profile",
        signature: "0xsigned",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Pending email change cancelled."
    );
  });

  it("resends before opening an expired pending email verification", async () => {
    const user = userEvent.setup();
    getOwnerProfileMock.mockResolvedValueOnce({
      ownerAddress: "0xabc",
      displayName: "Synapse Ops",
      email: "ops@synapse.test",
      emailVerified: true,
      pendingEmail: "new@synapse.test",
      emailVerificationStatus: "expired",
      emailVerificationSendsRemaining: 5,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:05:00",
    });

    render(<AccountSettingsPage />);

    await user.click(
      await screen.findByRole("button", { name: "Enter verification code" })
    );

    await waitFor(() => {
      expect(resendOwnerEmailCodeMock).toHaveBeenCalledWith(
        "0xabc",
        "new@synapse.test"
      );
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Verification code sent again."
    );
    expect(
      await screen.findByRole("dialog", { name: "Verify email" })
    ).toBeTruthy();
    expect(
      screen.getByText("You have 4 verification emails left today.")
    ).toBeTruthy();
  });
});
