"use client";

import {
  useEffect,
  useState,
  useCallback,
  createContext,
  useContext,
  useRef,
  useMemo,
} from "react";
import {
  useAccount,
  useAccountEffect,
  useDisconnect,
  useSignMessage,
} from "wagmi";
import { getAppRole } from "@/utils/roleStore";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearAuthSession,
  getStoredAuthSession,
  requestAuthChallenge,
  storeAuthSession,
  verifyAuthSignature,
} from "@/utils/authSession";
import {
  isWalletUnstableError,
  readInjectedAccounts,
  signWalletMessage,
} from "@/utils/walletSignature";
import {
  showWalletStatusErrorToast,
  showWalletStatusToast,
} from "@/utils/walletToast";

interface AuthContextType {
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  address: string | undefined;
  authError: string | null;
  isAuthorizing: boolean;
  authorize: () => Promise<boolean>;
}

export const AuthContext = createContext<AuthContextType>({
  isConnected: false,
  isSessionAuthenticated: false,
  address: undefined,
  authError: null,
  isAuthorizing: false,
  authorize: async () => false,
});

export const useAuth = () => useContext(AuthContext);

const SESSION_EXPIRED_TOAST_COOLDOWN_MS = 2500;
const E2E_WALLET_CONNECTED_STORAGE_KEY = "synapse_e2e_wallet_connected";

function readLocalE2eWalletAddress(): string | null {
  if (typeof window === "undefined") return null;
  const isLocalApp =
    process.env.NEXT_PUBLIC_APP_ENV === "local" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!isLocalApp) return null;
  if (window.localStorage.getItem(E2E_WALLET_CONNECTED_STORAGE_KEY) !== "1")
    return null;

  const session = getStoredAuthSession();
  return session?.wallet?.toLowerCase() || null;
}

export default function WalletAuthGuard({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [localE2eWallet, setLocalE2eWallet] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);
  const disconnectClearTimer = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const pendingAutoAuthorizeWalletRef = useRef<string | null>(null);
  const autoAuthorizeTriedWalletRef = useRef<string | null>(null);
  const authorizePromiseRef = useRef<Promise<boolean> | null>(null);
  const lastSessionExpiredToastAtRef = useRef(0);
  const effectiveAddress = address || localE2eWallet || undefined;
  const effectiveIsConnected = isConnected || Boolean(localE2eWallet);

  useEffect(() => {
    const e2eWallet = readLocalE2eWalletAddress();
    if (!e2eWallet) return;
    setLocalE2eWallet(e2eWallet);
    setVerifiedWallet(e2eWallet);
    setAuthError(null);
    setIsAuthorizing(false);
  }, []);

  const shouldForceReconnectForCurrentRole = useCallback((): boolean => {
    if (!effectiveAddress) return false;
    const role = getAppRole(effectiveAddress);
    return role === "CONSUMER" || role === "PROVIDER";
  }, [effectiveAddress]);

  const forceReconnectIfNeeded = useCallback(() => {
    if (!shouldForceReconnectForCurrentRole()) return;

    const now = Date.now();
    const withinCooldown =
      now - lastSessionExpiredToastAtRef.current <
      SESSION_EXPIRED_TOAST_COOLDOWN_MS;
    if (!withinCooldown) {
      lastSessionExpiredToastAtRef.current = now;
      showWalletStatusToast(
        "Session expired. Please reconnect wallet to continue.",
        {
          icon: "🔁",
        }
      );
    }

    try {
      if (isConnected) {
        disconnect();
      }
    } catch {
      // no-op: best-effort disconnect for consumer workspace
    }
  }, [disconnect, shouldForceReconnectForCurrentRole, isConnected]);

  // We no longer block access globally based on isPublicRoute.
  // The context provides auth state to downstream components that use <AuthMask />.

  const signChallengeMessage = useCallback(
    async (challengeMessage: string, walletAddress: string): Promise<string> =>
      signWalletMessage(challengeMessage, walletAddress, signMessageAsync),
    [signMessageAsync]
  );

  const handleAuthorizeFailure = useCallback(
    (error: unknown): void => {
      clearAuthSession();
      setVerifiedWallet(null);
      setIsAuthorizing(false);
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Wallet signature authentication failed or was cancelled";

      if (errorMsg.includes("unavailable while reconnecting")) {
        setAuthError(
          "Wallet is still reconnecting. Please try again shortly or manually reconnect."
        );
        showWalletStatusToast("Wallet reconnecting, please wait a moment.", {
          icon: "⏳",
        });
        return;
      }

      if (errorMsg.includes("Connector not connected")) {
        setAuthError(
          "Wallet connector is not ready. Please reconnect wallet and try authorize again."
        );
        showWalletStatusToast(
          "Wallet not fully connected yet. Please reconnect and retry.",
          { icon: "🔌" }
        );
        return;
      }

      if (errorMsg.includes("Multiple wallet accounts selected")) {
        setAuthError("Please select only one wallet account, then reconnect.");
        showWalletStatusToast(
          "Please select only one account in wallet, then reconnect.",
          {
            icon: "1️⃣",
          }
        );
        forceReconnectIfNeeded();
        return;
      }

      if (isWalletUnstableError(errorMsg)) {
        setAuthError(
          "Wallet connection is unstable. Please disconnect and reconnect your wallet, then try again."
        );
        showWalletStatusToast(
          "Wallet connection unstable. Please reconnect wallet and retry.",
          { icon: "⚠️" }
        );
        return;
      }

      setAuthError(errorMsg);
      if (
        errorMsg.includes("User rejected") ||
        String(error).includes("4001") ||
        String(error).includes("4100")
      ) {
        showWalletStatusToast("Signature request cancelled by user.", {
          icon: "ℹ️",
        });
        return;
      }

      showWalletStatusErrorToast("Auth failed: " + errorMsg);
    },
    [forceReconnectIfNeeded]
  );

  const authorize = useCallback(async (): Promise<boolean> => {
    if (!effectiveAddress || !effectiveIsConnected) return false;

    if (authorizePromiseRef.current) {
      return authorizePromiseRef.current;
    }

    const nextAuthorize = (async (): Promise<boolean> => {
      setIsAuthorizing(true);
      setAuthError(null);

      try {
        const normalizedWallet = effectiveAddress.toLowerCase();
        const existing = getStoredAuthSession();
        if (localE2eWallet && existing?.wallet === normalizedWallet) {
          setVerifiedWallet(existing.wallet);
          setIsAuthorizing(false);
          return true;
        }

        const connectedAccounts = await readInjectedAccounts();
        if (connectedAccounts.length > 1) {
          throw new Error(
            "Multiple wallet accounts selected. Please keep only one account selected, then reconnect."
          );
        }

        if (existing?.wallet === normalizedWallet) {
          setVerifiedWallet(existing.wallet);
          setIsAuthorizing(false);
          return true;
        }

        const challenge = await requestAuthChallenge(effectiveAddress);
        const challengeMessage = challenge.challenge;
        if (!challengeMessage) {
          throw new Error("Auth challenge missing from server response");
        }

        const signature = await signChallengeMessage(
          challengeMessage,
          effectiveAddress
        );

        const verified = await verifyAuthSignature(
          effectiveAddress,
          challengeMessage,
          signature
        );
        storeAuthSession(
          verified.token,
          verified.wallet,
          verified.expiresInSec
        );

        setVerifiedWallet(verified.wallet.toLowerCase());
        setIsAuthorizing(false);
        return true;
      } catch (error) {
        handleAuthorizeFailure(error);
        return false;
      }
    })();

    authorizePromiseRef.current = nextAuthorize;
    try {
      return await nextAuthorize;
    } finally {
      authorizePromiseRef.current = null;
    }
  }, [
    effectiveAddress,
    effectiveIsConnected,
    localE2eWallet,
    signChallengeMessage,
    handleAuthorizeFailure,
  ]);

  const isSessionAuthenticated = Boolean(
    verifiedWallet &&
      !authError &&
      !isAuthorizing &&
      effectiveIsConnected &&
      effectiveAddress
  );

  useAccountEffect({
    onConnect(data) {
      if (!data.address) return;
      pendingAutoAuthorizeWalletRef.current = data.address.toLowerCase();
      autoAuthorizeTriedWalletRef.current = null;
    },
    onDisconnect() {
      pendingAutoAuthorizeWalletRef.current = null;
      autoAuthorizeTriedWalletRef.current = null;
    },
  });

  useEffect(() => {
    if (!effectiveIsConnected || !effectiveAddress) {
      autoAuthorizeTriedWalletRef.current = null;
      return;
    }

    if (isSessionAuthenticated || isAuthorizing) return;

    const normalized = effectiveAddress.toLowerCase();
    if (pendingAutoAuthorizeWalletRef.current !== normalized) return;
    if (autoAuthorizeTriedWalletRef.current === normalized) return;

    autoAuthorizeTriedWalletRef.current = normalized;
    void authorize();
  }, [
    effectiveIsConnected,
    effectiveAddress,
    isSessionAuthenticated,
    isAuthorizing,
    authorize,
  ]);

  useEffect(() => {
    if (disconnectClearTimer.current) {
      globalThis.clearTimeout(disconnectClearTimer.current);
      disconnectClearTimer.current = null;
    }

    if (!effectiveIsConnected || !effectiveAddress) {
      // Some wallets briefly report disconnected while reconnecting.
      // Delay clearing to avoid forcing unnecessary re-sign.
      disconnectClearTimer.current = globalThis.setTimeout(() => {
        clearAuthSession();
        setVerifiedWallet(null);
        setAuthError(null);
        setIsAuthorizing(false);
      }, 12000);
      return;
    }

    // Detect wallet address change (串号保护)
    if (
      verifiedWallet &&
      effectiveAddress.toLowerCase() !== verifiedWallet.toLowerCase()
    ) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError(
        "The wallet address has changed, please re-sign to synchronize sessions"
      );
      setIsAuthorizing(false);
      forceReconnectIfNeeded();
      return;
    }

    // Page-level behavior: recover existing session only, do not auto-trigger wallet challenge.
    const existing = getStoredAuthSession();
    if (existing?.wallet === effectiveAddress.toLowerCase()) {
      setVerifiedWallet(existing.wallet);
      setAuthError(null);
      setIsAuthorizing(false);
      return;
    }

    if (existing && existing.wallet !== effectiveAddress.toLowerCase()) {
      clearAuthSession();
      forceReconnectIfNeeded();
    }

    if (!isAuthorizing) {
      setVerifiedWallet(null);
    }

    return () => {
      if (disconnectClearTimer.current) {
        globalThis.clearTimeout(disconnectClearTimer.current);
        disconnectClearTimer.current = null;
      }
    };
  }, [
    effectiveIsConnected,
    effectiveAddress,
    verifiedWallet,
    authError,
    isAuthorizing,
    authorize,
    forceReconnectIfNeeded,
  ]);

  useEffect(() => {
    if (!effectiveIsConnected || !effectiveAddress || !verifiedWallet) return;

    const session = getStoredAuthSession();
    if (session?.wallet !== effectiveAddress.toLowerCase()) return;

    const timeoutMs = Math.max(0, session.expiresAt - Date.now());
    const timer = globalThis.setTimeout(() => {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError("Session expired automatically. Please sign in again.");
      forceReconnectIfNeeded();
    }, timeoutMs + 50);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [
    effectiveAddress,
    effectiveIsConnected,
    verifiedWallet,
    forceReconnectIfNeeded,
  ]);

  useEffect(() => {
    const onSessionExpired = () => {
      clearAuthSession();
      setAuthError(
        "Your authentication session has expired or is invalid. Please sign in again."
      );
      setVerifiedWallet(null);
      setIsAuthorizing(false);
      forceReconnectIfNeeded();
    };

    globalThis.window.addEventListener(
      AUTH_SESSION_EXPIRED_EVENT,
      onSessionExpired as EventListener
    );
    return () => {
      globalThis.window.removeEventListener(
        AUTH_SESSION_EXPIRED_EVENT,
        onSessionExpired as EventListener
      );
    };
  }, [forceReconnectIfNeeded]);

  const authContextValue = useMemo(
    () => ({
      isConnected: effectiveIsConnected,
      isSessionAuthenticated,
      address: effectiveAddress,
      authError,
      isAuthorizing,
      authorize,
    }),
    [
      effectiveIsConnected,
      isSessionAuthenticated,
      effectiveAddress,
      authError,
      isAuthorizing,
      authorize,
    ]
  );

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
}
