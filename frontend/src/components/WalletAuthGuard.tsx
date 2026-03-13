"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
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
  const { isConnected, address, connector } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);

  // We no longer block access globally based on isPublicRoute.
  // The context provides auth state to downstream components that use <AuthMask />.

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
      
      let signature;
      try {
        signature = await signMessageAsync({
          message: challenge.message,
        });
      } catch (signErr: unknown) {
        const msg = signErr instanceof Error ? signErr.message : String(signErr);
        // Fallback for non-standard injected wallets (e.g. Gate.io) lacking .getChainId interface in wagmi
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (msg.includes("getChainId") || msg.includes("reading 'raw'") || msg.includes("Cannot read properties of undefined")) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof window !== "undefined" && (window as any).ethereum) {
            console.warn("Wagmi connector failed, falling back to window.ethereum.request personal_sign...");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            signature = await (window as any).ethereum.request({
              method: "personal_sign",
              params: [toHex(challenge.message), address],
            });
          } else {
            throw signErr;
          }
        } else {
          throw signErr;
        }
      }

      const verified = await verifyAuthSignature(address, challenge.nonce, signature);
      storeAuthSession(verified.token, verified.wallet);

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
      
      setAuthError(errorMsg);
      // Suppress EIP-1193 rejection messages to be less annoying, unless they are actual errors
      if (errorMsg.includes("User rejected") || String(error).includes("4001") || String(error).includes("4100")) {
        toast("Signature request cancelled by user.", { icon: "ℹ️" });
      } else {
        toast.error("Auth failed: " + errorMsg);
      }
      return false;
    }
  }, [address, signMessageAsync]);

  useEffect(() => {
    if (!isConnected || !address) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError(null);
      setIsAuthorizing(false);
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

    if (!verifiedWallet && !authError && !isAuthorizing) {
      void authorize();
    }
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
