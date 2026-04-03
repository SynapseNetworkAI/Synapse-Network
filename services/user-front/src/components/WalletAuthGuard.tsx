"use client";

import { useEffect, useState, useCallback, createContext, useContext, useRef, useMemo } from "react";
import { useAccount, useAccountEffect, useDisconnect, useSignMessage } from "wagmi";
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
import { showWalletStatusErrorToast, showWalletStatusToast } from "@/utils/walletToast";

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

export default function WalletAuthGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);
  const disconnectClearTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const pendingAutoAuthorizeWalletRef = useRef<string | null>(null);
  const autoAuthorizeTriedWalletRef = useRef<string | null>(null);
  const lastSessionExpiredToastAtRef = useRef(0);

  const shouldForceReconnectForCurrentRole = useCallback((): boolean => {
    if (!address) return false;
    const role = getAppRole(address);
    return role === "CONSUMER" || role === "PROVIDER";
  }, [address]);

  const forceReconnectIfNeeded = useCallback(() => {
    if (!shouldForceReconnectForCurrentRole()) return;

    const now = Date.now();
    const withinCooldown = now - lastSessionExpiredToastAtRef.current < SESSION_EXPIRED_TOAST_COOLDOWN_MS;
    if (!withinCooldown) {
      lastSessionExpiredToastAtRef.current = now;
      showWalletStatusToast("Session expired. Please reconnect wallet to continue.", {
        icon: "🔁",
      });
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

  const handleAuthorizeFailure = useCallback((error: unknown): void => {
    clearAuthSession();
    setVerifiedWallet(null);
    setIsAuthorizing(false);
    const errorMsg = error instanceof Error ? error.message : "Wallet signature authentication failed or was cancelled";

    if (errorMsg.includes("unavailable while reconnecting")) {
      setAuthError("Wallet is still reconnecting. Please try again shortly or manually reconnect.");
      showWalletStatusToast("Wallet reconnecting, please wait a moment.", { icon: "⏳" });
      return;
    }

    if (errorMsg.includes("Connector not connected")) {
      setAuthError("Wallet connector is not ready. Please reconnect wallet and try authorize again.");
      showWalletStatusToast("Wallet not fully connected yet. Please reconnect and retry.", { icon: "🔌" });
      return;
    }

    if (errorMsg.includes("Multiple wallet accounts selected")) {
      setAuthError("Please select only one wallet account, then reconnect.");
      showWalletStatusToast("Please select only one account in wallet, then reconnect.", {
        icon: "1️⃣",
      });
      forceReconnectIfNeeded();
      return;
    }

    if (isWalletUnstableError(errorMsg)) {
      setAuthError("Wallet connection is unstable. Please disconnect and reconnect your wallet, then try again.");
      showWalletStatusToast("Wallet connection unstable. Please reconnect wallet and retry.", { icon: "⚠️" });
      return;
    }

    setAuthError(errorMsg);
    if (errorMsg.includes("User rejected") || String(error).includes("4001") || String(error).includes("4100")) {
      showWalletStatusToast("Signature request cancelled by user.", { icon: "ℹ️" });
      return;
    }

    showWalletStatusErrorToast("Auth failed: " + errorMsg);
  }, [forceReconnectIfNeeded]);

  const authorize = useCallback(async (): Promise<boolean> => {
    if (!address || !isConnected) return false;
    setIsAuthorizing(true);
    setAuthError(null);

    try {
      const connectedAccounts = await readInjectedAccounts();
      if (connectedAccounts.length > 1) {
        throw new Error("Multiple wallet accounts selected. Please keep only one account selected, then reconnect.");
      }

      const existing = getStoredAuthSession();
      if (existing?.wallet === address.toLowerCase()) {
        setVerifiedWallet(existing.wallet);
        setIsAuthorizing(false);
        return true;
      }

      const challenge = await requestAuthChallenge(address);
      const challengeMessage = challenge.challenge;
      if (!challengeMessage) {
        throw new Error("Auth challenge missing from server response");
      }

      const signature = await signChallengeMessage(challengeMessage, address);

      const verified = await verifyAuthSignature(address, challengeMessage, signature);
      storeAuthSession(verified.token, verified.wallet, verified.expiresInSec);

      setVerifiedWallet(verified.wallet.toLowerCase());
      setIsAuthorizing(false);
      return true;
    } catch (error) {
      handleAuthorizeFailure(error);
      return false;
    }
  }, [address, isConnected, signChallengeMessage, handleAuthorizeFailure]);

  const isSessionAuthenticated = Boolean(verifiedWallet && !authError && !isAuthorizing && isConnected && address);

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
    if (!isConnected || !address) {
      autoAuthorizeTriedWalletRef.current = null;
      return;
    }

    if (isSessionAuthenticated || isAuthorizing) return;

    const normalized = address.toLowerCase();
    if (pendingAutoAuthorizeWalletRef.current !== normalized) return;
    if (autoAuthorizeTriedWalletRef.current === normalized) return;

    autoAuthorizeTriedWalletRef.current = normalized;
    void authorize();
  }, [isConnected, address, isSessionAuthenticated, isAuthorizing, authorize]);

  useEffect(() => {
    if (disconnectClearTimer.current) {
      globalThis.clearTimeout(disconnectClearTimer.current);
      disconnectClearTimer.current = null;
    }

    if (!isConnected || !address) {
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
    if (verifiedWallet && address.toLowerCase() !== verifiedWallet.toLowerCase()) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError("The wallet address has changed, please re-sign to synchronize sessions");
      setIsAuthorizing(false);
      forceReconnectIfNeeded();
      return;
    }

    // Page-level behavior: recover existing session only, do not auto-trigger wallet challenge.
    const existing = getStoredAuthSession();
    if (existing?.wallet === address.toLowerCase()) {
      setVerifiedWallet(existing.wallet);
      setAuthError(null);
      setIsAuthorizing(false);
      return;
    }

    if (existing && existing.wallet !== address.toLowerCase()) {
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
  }, [isConnected, address, verifiedWallet, authError, isAuthorizing, authorize, forceReconnectIfNeeded]);

  useEffect(() => {
    if (!isConnected || !address || !verifiedWallet) return;

    const session = getStoredAuthSession();
    if (session?.wallet !== address.toLowerCase()) return;

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
  }, [address, isConnected, verifiedWallet, forceReconnectIfNeeded]);

  useEffect(() => {
    const onSessionExpired = () => {
      clearAuthSession();
      setAuthError("Your authentication session has expired or is invalid. Please sign in again.");
      setVerifiedWallet(null);
      setIsAuthorizing(false);
      forceReconnectIfNeeded();
    };

    globalThis.window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
    return () => {
      globalThis.window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
    };
  }, [forceReconnectIfNeeded]);

  const authContextValue = useMemo(() => ({
    isConnected,
    isSessionAuthenticated,
    address,
    authError,
    isAuthorizing,
    authorize,
  }), [isConnected, isSessionAuthenticated, address, authError, isAuthorizing, authorize]);

  return (
    <AuthContext.Provider value={authContextValue}>
      {children}
    </AuthContext.Provider>
  );
}
