import {
  showWalletStatusErrorToast,
  showWalletStatusToast,
} from "@/utils/walletToast";
import { isWalletUserRejectedError } from "@/utils/walletActionErrors";
import { isWalletUnstableError } from "@/utils/walletSignature";
import { isWalletChainMismatchError } from "@/utils/walletNetwork";
import { getStoredAuthSession } from "@/utils/authSession";

const E2E_WALLET_CONNECTED_STORAGE_KEY = "synapse_e2e_wallet_connected";

type Translate = (
  key: string,
  params?: Record<string, string | number>
) => string;

export interface AuthContextType {
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  address: string | undefined;
  authError: string | null;
  isAuthorizing: boolean;
  authorize: () => Promise<boolean>;
}

export type LoginIntentState = {
  domain: string;
  wallet: string;
  chainId: number;
};

export function readLocalE2eWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  const isLocalApp =
    process.env.NEXT_PUBLIC_APP_ENV === "local" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!isLocalApp) return null;
  if (window.localStorage.getItem(E2E_WALLET_CONNECTED_STORAGE_KEY) !== "1") {
    return null;
  }

  const session = getStoredAuthSession();
  return session?.wallet?.toLowerCase() || null;
}

type WalletAuthFailureResult = {
  authError: string | null;
  shouldForceReconnect: boolean;
};

export function handleWalletAuthFailure(
  error: unknown,
  t: Translate
): WalletAuthFailureResult {
  if (isWalletUserRejectedError(error)) {
    showWalletStatusToast(t("walletActions.requestCancelled"), {
      icon: "ℹ️",
    });
    return {
      authError: null,
      shouldForceReconnect: false,
    };
  }

  const errorMsg =
    error instanceof Error
      ? error.message
      : "Wallet signature authentication failed or was cancelled";

  if (errorMsg.includes("unavailable while reconnecting")) {
    const message = t("walletActions.walletReconnecting");
    showWalletStatusToast(message, { icon: "⏳" });
    return {
      authError: message,
      shouldForceReconnect: false,
    };
  }

  if (errorMsg.includes("Connector not connected")) {
    const message = t("walletActions.walletConnectorNotReady");
    showWalletStatusToast(message, { icon: "🔌" });
    return {
      authError: message,
      shouldForceReconnect: false,
    };
  }

  if (errorMsg.includes("Multiple wallet accounts selected")) {
    const message = t("walletActions.walletSingleAccount");
    showWalletStatusToast(message, { icon: "1️⃣" });
    return {
      authError: message,
      shouldForceReconnect: true,
    };
  }

  if (isWalletUnstableError(errorMsg)) {
    const message = t("walletActions.walletUnstable");
    showWalletStatusToast(message, { icon: "⚠️" });
    return {
      authError: message,
      shouldForceReconnect: false,
    };
  }

  if (errorMsg === "Failed to fetch") {
    const message = t("walletActions.authGatewayUnavailable");
    showWalletStatusErrorToast(message);
    return {
      authError: message,
      shouldForceReconnect: false,
    };
  }

  if (isWalletChainMismatchError(errorMsg)) {
    const message = t("walletActions.walletWrongNetwork");
    showWalletStatusErrorToast(message);
    return {
      authError: message,
      shouldForceReconnect: false,
    };
  }

  showWalletStatusErrorToast(
    t("walletActions.authFailedPrefix", { message: errorMsg })
  );
  return {
    authError: errorMsg,
    shouldForceReconnect: false,
  };
}
