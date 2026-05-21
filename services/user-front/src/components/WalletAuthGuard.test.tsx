// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  signMessageAsyncMock,
  requestAuthChallengeMock,
  verifyAuthSignatureMock,
  storeAuthSessionMock,
  clearAuthSessionMock,
  toastDefaultMock,
  toastErrorMock,
  wagmiState,
} = vi.hoisted(() => ({
  signMessageAsyncMock: vi.fn(),
  requestAuthChallengeMock: vi.fn(),
  verifyAuthSignatureMock: vi.fn(),
  storeAuthSessionMock: vi.fn(),
  clearAuthSessionMock: vi.fn(),
  toastDefaultMock: vi.fn(),
  toastErrorMock: vi.fn(),
  wagmiState: {
    isConnected: true,
    address: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
    connectorName: "Injected",
    connectorId: "injected",
    chainId: 31337,
  },
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(toastDefaultMock, {
    error: toastErrorMock,
  }),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    isConnected: wagmiState.isConnected,
    address: wagmiState.address,
    connector: { name: wagmiState.connectorName, id: wagmiState.connectorId },
  }),
  useAccountEffect: () => undefined,
  useChainId: () => wagmiState.chainId,
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSignMessage: () => ({ signMessageAsync: signMessageAsyncMock }),
}));

vi.mock("@/utils/roleStore", () => ({
  getAppRole: () => "CONSUMER",
}));

vi.mock("@/utils/authSession", () => ({
  AUTH_SESSION_EXPIRED_EVENT: "a2a:auth-session-expired",
  clearAuthSession: clearAuthSessionMock,
  getStoredAuthSession: () => null,
  requestAuthChallenge: requestAuthChallengeMock,
  storeAuthSession: storeAuthSessionMock,
  verifyAuthSignature: verifyAuthSignatureMock,
}));

vi.mock("@/utils/walletSignature", () => ({
  isWalletUnstableError: () => false,
  readInjectedAccounts: () => Promise.resolve([]),
  signWalletMessage: (
    message: string,
    _walletAddress: string,
    signMessageAsync: (payload: { message: string }) => Promise<string>
  ) => signMessageAsync({ message }),
}));

vi.mock("@/utils/runtimeEnv", () => ({
  getRuntimeEnvironmentConfig: () => ({
    appEnv: "prod",
    chainId: 42161,
    chainName: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    txExplorerBaseUrl: "https://arbiscan.io/tx/",
  }),
}));

vi.mock("@/utils/walletNetwork", () => ({
  ensureWalletOnRuntimeChain: () => Promise.resolve(),
  isWalletChainMismatchError: (message: string) =>
    message.toLowerCase().includes("chain id does not match"),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (
      key: string,
      vars?: Record<string, string | number>,
      fallbackText?: string
    ) => {
      const messages: Record<string, string> = {
        "walletActions.loginTitle": "Sign in to SynapseNetwork",
        "walletActions.loginDescription": "Review the request",
        "walletActions.loginPurposeLabel": "Purpose",
        "walletActions.loginPurposeValue": "Create a session",
        "walletActions.loginDomainLabel": "Domain",
        "walletActions.loginWalletLabel": "Wallet",
        "walletActions.loginNetworkLabel": "Network",
        "walletActions.loginNoFundsLabel": "Funds",
        "walletActions.loginNoFundsValue": "No transaction. No funds move.",
        "walletActions.loginChecklistTitle": "Wallet checklist",
        "walletActions.loginChecklistDomain": "Domain must match",
        "walletActions.loginChecklistNoFunds": "No funds movement",
        "walletActions.loginChecklistNonce": "Fresh nonce every retry",
        "walletActions.continueToWallet": "Continue to wallet",
        "walletActions.cancel": "Cancel",
        "walletActions.close": "Close wallet request",
        "walletActions.requestCancelled": "Request cancelled.",
        "walletActions.sessionExpiredRetry": "Session expired. Retry.",
        "walletActions.walletReconnecting": "Wallet reconnecting.",
        "walletActions.walletConnectorNotReady": "Wallet not ready.",
        "walletActions.walletSingleAccount": "Select one account.",
        "walletActions.walletUnstable": "Wallet unstable.",
        "walletActions.walletUnsupportedForArbitrum":
          "Phantom currently does not support Arbitrum. Please use MetaMask or Rabby for Synapse on Arbitrum.",
        "walletActions.authFailedPrefix": `Auth failed: ${vars?.message ?? ""}`,
      };
      return messages[key] ?? fallbackText ?? key;
    },
  }),
}));

import WalletAuthGuard, { useAuth } from "@/components/WalletAuthGuard";

function AuthorizeButton() {
  const { authorize, isAuthorizing } = useAuth();
  return (
    <button type="button" onClick={() => void authorize()}>
      {isAuthorizing ? "authorizing" : "authorize"}
    </button>
  );
}

describe("WalletAuthGuard", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    wagmiState.isConnected = true;
    wagmiState.address = "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8";
    wagmiState.connectorName = "Injected";
    wagmiState.connectorId = "injected";
    wagmiState.chainId = 31337;
    (
      globalThis as typeof globalThis & {
        ethereum?: unknown;
      }
    ).ethereum = undefined;
    requestAuthChallengeMock.mockResolvedValue({
      success: true,
      domain: "localhost:3000",
      challenge: "challenge-one",
    });
    verifyAuthSignatureMock.mockResolvedValue({
      token: "jwt",
      wallet: "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8",
      expiresInSec: 3600,
    });
    signMessageAsyncMock.mockResolvedValue("0xsignature");
  });

  it("requests a fresh challenge before each login intent and waits for continue", async () => {
    const user = userEvent.setup();
    render(
      <WalletAuthGuard>
        <AuthorizeButton />
      </WalletAuthGuard>
    );

    await user.click(screen.getByRole("button", { name: "authorize" }));

    expect(requestAuthChallengeMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Sign in to SynapseNetwork")).toBeTruthy();
    expect(screen.getByText("localhost:3000")).toBeTruthy();
    expect(signMessageAsyncMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(toastDefaultMock).toHaveBeenCalledWith("Request cancelled.", {
      icon: "ℹ️",
      id: "wallet-status",
    });

    await user.click(screen.getByRole("button", { name: "authorize" }));
    expect(requestAuthChallengeMock).toHaveBeenCalledTimes(2);
  });

  it("handles wallet rejection without red error toast or stuck loading", async () => {
    const user = userEvent.setup();
    signMessageAsyncMock.mockRejectedValue({
      code: 4001,
      message: "User rejected",
    });

    render(
      <WalletAuthGuard>
        <AuthorizeButton />
      </WalletAuthGuard>
    );

    await user.click(screen.getByRole("button", { name: "authorize" }));
    await user.click(
      await screen.findByRole("button", { name: "Continue to wallet" })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "authorize" })).toBeTruthy();
    });
    expect(toastDefaultMock).toHaveBeenCalledWith("Request cancelled.", {
      icon: "ℹ️",
      id: "wallet-status",
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("blocks Phantom on Arbitrum before requesting a challenge", async () => {
    const user = userEvent.setup();
    wagmiState.connectorName = "Phantom";
    wagmiState.connectorId = "phantom";
    wagmiState.chainId = 42161;
    (
      globalThis as typeof globalThis & {
        ethereum?: unknown;
      }
    ).ethereum = { isPhantom: true };

    render(
      <WalletAuthGuard>
        <AuthorizeButton />
      </WalletAuthGuard>
    );

    await user.click(screen.getByRole("button", { name: "authorize" }));

    await waitFor(() => {
      expect(toastDefaultMock).toHaveBeenCalledWith(
        "Phantom currently does not support Arbitrum. Please use MetaMask or Rabby for Synapse on Arbitrum.",
        {
          icon: "🧭",
          id: "wallet-status",
        }
      );
    });

    expect(requestAuthChallengeMock).not.toHaveBeenCalled();
    expect(signMessageAsyncMock).not.toHaveBeenCalled();
  });

  it("allows MetaMask on Arbitrum when Phantom is also installed", async () => {
    const user = userEvent.setup();
    wagmiState.connectorName = "MetaMask";
    wagmiState.connectorId = "metaMask";
    wagmiState.chainId = 42161;
    (
      globalThis as typeof globalThis & {
        ethereum?: unknown;
      }
    ).ethereum = {
      providers: [{ isMetaMask: true }, { isPhantom: true }],
    };

    render(
      <WalletAuthGuard>
        <AuthorizeButton />
      </WalletAuthGuard>
    );

    await user.click(screen.getByRole("button", { name: "authorize" }));

    expect(requestAuthChallengeMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(
        "Phantom currently does not support Arbitrum. Please use MetaMask or Rabby for Synapse on Arbitrum."
      )
    ).toBeNull();
  });
});
