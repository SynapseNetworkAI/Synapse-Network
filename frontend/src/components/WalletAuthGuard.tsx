"use client";

import { useEffect, useState, useCallback, createContext, useContext, useRef } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { toHex } from "viem";
import toast from "react-hot-toast";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearAuthSession,
  getStoredAuthSession,
  requestAuthChallenge,
  storeAuthSession,
  verifyAuthSignature,
} from "@/utils/authSession";

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

export default function WalletAuthGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);
  const disconnectClearTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  // We no longer block access globally based on isPublicRoute.
  // The context provides auth state to downstream components that use <AuthMask />.

  const signWithInjectedProvider = useCallback(async (message: string, walletAddress: string): Promise<string> => {
    const ethereum = (globalThis as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<string> } }).ethereum;
    if (!ethereum) {
      throw new Error("Wallet provider unavailable. Please reconnect wallet and retry.");
    }

    const hexMessage = toHex(message);
    const attempts: Array<unknown[]> = [
      [hexMessage, walletAddress],
      [walletAddress, hexMessage],
      [message, walletAddress],
      [walletAddress, message],
    ];

    let lastErr: unknown = null;
    for (const params of attempts) {
      try {
        const sig = await ethereum.request({
          method: "personal_sign",
          params,
        });
        if (typeof sig === "string" && sig.length > 0) return sig;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr ?? new Error("Wallet signature failed. Please reconnect wallet and retry.");
  }, []);

  const authorize = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    setIsAuthorizing(true);
    setAuthError(null);

    try {
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
      
      let signature;
      try {
        signature = await signMessageAsync({
          message: challengeMessage,
        });
      } catch (signErr: unknown) {
        const msg = signErr instanceof Error ? signErr.message : String(signErr);
        const shouldFallback =
          msg.includes("getChainId") ||
          msg.includes("reading 'raw'") ||
          msg.includes("reading 'length'") ||
          msg.includes("Cannot read properties of undefined") ||
          msg.includes("unavailable while reconnecting");
        if (shouldFallback) {
          console.warn("Wagmi signing failed, falling back to injected provider personal_sign...");
          signature = await signWithInjectedProvider(challengeMessage, address);
        } else {
          throw signErr;
        }
      }

      const verified = await verifyAuthSignature(address, challengeMessage, signature);
      storeAuthSession(verified.token, verified.wallet, verified.expiresInSec);

      setVerifiedWallet(verified.wallet.toLowerCase());
      setIsAuthorizing(false);
      return true;
    } catch (error) {
      clearAuthSession();
      setVerifiedWallet(null);
      setIsAuthorizing(false);
      const errorMsg = error instanceof Error ? error.message : "Wallet signature authentication failed or was cancelled";
      
      // Handle the strict Wagmi "unavailable while reconnecting" warning smoothly
      if (errorMsg.includes("unavailable while reconnecting")) {
        setAuthError("Wallet is still reconnecting. Please try again shortly or manually reconnect.");
        toast("Wallet reconnecting, please wait a moment.", { icon: "⏳" });
        return false;
      }

      if (
        errorMsg.includes("Cannot read properties of undefined") ||
        errorMsg.includes("reading 'length'") ||
        errorMsg.includes("reading 'raw'")
      ) {
        setAuthError("Wallet connection is unstable. Please disconnect and reconnect your wallet, then try again.");
        toast("Wallet connection unstable. Please reconnect wallet and retry.", { icon: "⚠️" });
        return false;
      }
      
      setAuthError(errorMsg);
      // Suppress EIP-1193 rejection messages to be less annoying, unless they are actual errors
      if (errorMsg.includes("User rejected") || String(error).includes("4001") || String(error).includes("4100")) {
        toast("Signature request cancelled by user.", { icon: "ℹ️" });
      } else {
        toast.error("Auth failed: " + errorMsg);
      }
      return false;
    }
  }, [address, signMessageAsync, signWithInjectedProvider]);

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
  }, [isConnected, address, verifiedWallet, authError, isAuthorizing, authorize]);

  useEffect(() => {
    if (!isConnected || !address || !verifiedWallet) return;

    const session = getStoredAuthSession();
    if (session?.wallet !== address.toLowerCase()) return;

    const timeoutMs = Math.max(0, session.expiresAt - Date.now());
    const timer = globalThis.setTimeout(() => {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError("Session expired automatically. Please sign in again.");
    }, timeoutMs + 50);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [address, isConnected, verifiedWallet]);

  useEffect(() => {
    const onSessionExpired = () => {
      clearAuthSession();
      setAuthError("Your authentication session has expired or is invalid. Please sign in again.");
      setVerifiedWallet(null);
      setIsAuthorizing(false);
    };

    globalThis.window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
    return () => {
      globalThis.window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
    };
  }, []);

  const isSessionAuthenticated = Boolean(verifiedWallet && !authError && !isAuthorizing && isConnected && address);

  return (
    <AuthContext.Provider value={{
      isConnected,
      isSessionAuthenticated,
      address,
      authError,
      isAuthorizing,
      authorize
    }}>
      {children}
    </AuthContext.Provider>
  );
}
