// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AccountSettingsPage from "@/components/dashboard-workspace/AccountSettingsPage";

const {
  authorizeMock,
  getOwnerProfileMock,
  requestOwnerProfileChallengeMock,
  updateOwnerProfileMock,
  signMessageAsyncMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  authorizeMock: vi.fn(async () => true),
  getOwnerProfileMock: vi.fn(),
  requestOwnerProfileChallengeMock: vi.fn(),
  updateOwnerProfileMock: vi.fn(),
  signMessageAsyncMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const TRANSLATIONS: Record<string, string> = {
  "accountSettingsPage.title": "Account Settings",
  "accountSettingsPage.description": "Bind operator identity to your owner wallet without adding a second account system. Name and email stay optional, but every mutation is signed by the wallet.",
  "accountSettingsPage.profileTitle": "Wallet-bound profile",
  "accountSettingsPage.profileDescription": "This profile is attached to your owner wallet. Save actions require a fresh wallet signature, so nobody can spoof account metadata from a stale JWT alone.",
  "accountSettingsPage.identitySummaryTitle": "Current identity",
  "accountSettingsPage.connectedWallet": "Connected wallet",
  "accountSettingsPage.notConnected": "Wallet not connected",
  "accountSettingsPage.walletCardTitle": "Wallet trust anchor",
  "accountSettingsPage.walletSessionMissing": "Reconnect the wallet to unlock signed profile updates.",
  "accountSettingsPage.nameLabel": "Account name",
  "accountSettingsPage.namePlaceholder": "Synapse operator",
  "accountSettingsPage.nameHelp": "Shown as your operator-facing account label across the control plane.",
  "accountSettingsPage.emailLabel": "Email",
  "accountSettingsPage.emailPlaceholder": "ops@yourcompany.com",
  "accountSettingsPage.emailHelp": "Email is optional. If you change it later, verification resets until the next email proof flow lands.",
  "accountSettingsPage.emailVerified": "Email is linked to this wallet. Verified flag is currently wallet-side only.",
  "accountSettingsPage.invalidEmail": "Enter a valid email address.",
  "accountSettingsPage.notifyMarketingTitle": "Earning reports",
  "accountSettingsPage.notifyMarketingDescription": "Receive non-critical ecosystem and revenue summaries on the linked email.",
  "accountSettingsPage.notifyAlertsTitle": "Budget alerts",
  "accountSettingsPage.notifyAlertsDescription": "Receive high-signal notifications when credits, spend caps, or risk conditions need action.",
  "accountSettingsPage.securityTitle": "Session Security",
  "accountSettingsPage.securityDescription": "Your wallet remains the only root identity. JWT proves session continuity; wallet signature proves profile ownership at write time.",
  "accountSettingsPage.saveButton": "Save settings",
  "accountSettingsPage.saving": "Saving...",
  "accountSettingsPage.saveHint": "Save will request one fresh wallet signature to bind this profile update to your owner address.",
  "accountSettingsPage.saveRequiresWallet": "Viewing can use the current session, but saving still requires the live wallet to sign the profile update.",
  "accountSettingsPage.saveSuccess": "Account settings updated.",
  "accountSettingsPage.saveFailed": "Failed to update account settings.",
  "accountSettingsPage.loadFailed": "Failed to load account settings.",
  "accountSettingsPage.authorizeFirst": "Wallet session missing. Please authorize with wallet first.",
  "accountSettingsPage.walletRequired": "Wallet session missing. Please reconnect and try again.",
  "accountSettingsPage.connectWalletToSave": "Reconnect the wallet to sign and save account settings.",
  "accountSettingsPage.walletReconnectRequired": "Wallet connection is unstable. Please reconnect and retry the save.",
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
  requestOwnerProfileChallenge: requestOwnerProfileChallengeMock,
  updateOwnerProfile: updateOwnerProfileMock,
}));

vi.mock("@/utils/walletSignature", () => ({
  signWalletMessage: vi.fn(
    async (_challenge: string, _walletAddress: string, _signMessageAsync: unknown) =>
      "0xsigned"
  ),
  isWalletUnstableError: (message: string) =>
    message.includes("reading 'raw'") || message.includes("Connector not connected"),
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
      emailVerified: false,
      notifyMarketing: true,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:00:00",
    });
    requestOwnerProfileChallengeMock.mockResolvedValue("Update Synapse account profile");
    updateOwnerProfileMock.mockResolvedValue({
      ownerAddress: "0xabc",
      displayName: "Synapse Infra",
      email: "infra@synapse.test",
      emailVerified: false,
      notifyMarketing: false,
      notifyAlerts: true,
      createdAt: "2026-04-03 10:00:00",
      updatedAt: "2026-04-03 10:02:00",
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
    expect(toastSuccessMock).toHaveBeenCalledWith("Account settings updated.");
  });

  it("blocks invalid email before signature request", async () => {
    const user = userEvent.setup();

    render(<AccountSettingsPage />);

    const emailInput = (await screen.findByLabelText("Email")) as HTMLInputElement;
    await user.clear(emailInput);
    await user.type(emailInput, "bad-email");
    const saveButton = screen.getByRole("button", { name: "Save settings" });

    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(saveButton.getAttribute("disabled")).not.toBeNull();
    expect(requestOwnerProfileChallengeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
