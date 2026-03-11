"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearAuthSession,
  getStoredAuthSession,
  requestAuthChallenge,
  storeAuthSession,
  verifyAuthSignature,
} from "@/utils/authSession";

export default function WalletAuthGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);

  const normalizedAddress = useMemo(() => address?.toLowerCase() || null, [address]);

  const authorize = useCallback(async () => {
    if (!address) return;
    setIsAuthorizing(true);
    setAuthError(null);

    try {
      const existing = getStoredAuthSession();
      if (existing?.wallet === address.toLowerCase()) {
        setVerifiedWallet(existing.wallet);
        setIsAuthorizing(false);
        return;
      }

      const challenge = await requestAuthChallenge(address);
      const signature = await signMessageAsync({
        message: challenge.message,
      });

      const verified = await verifyAuthSignature(address, challenge.nonce, signature);
      storeAuthSession(verified.token, verified.wallet);

      setVerifiedWallet(verified.wallet.toLowerCase());
      setIsAuthorizing(false);
    } catch (error) {
      clearAuthSession();
      setVerifiedWallet(null);
      setIsAuthorizing(false);
      setAuthError(error instanceof Error ? error.message : "Wallet signature authentication failed or was cancelled");
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

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Wallet className="w-16 h-16 mb-6 text-green-400 animate-pulse" />
        <h2 className="mb-4 text-2xl font-bold">Web3 Identity Required</h2>
        <p className="max-w-md mb-8 text-gray-400">
          Please connect your wallet to access provider controls. Wallet signature login will be completed after connection.
        </p>
        <ConnectButton />
      </div>
    );
  }

  if (authError && !isAuthorizing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <ShieldCheck className="w-12 h-12 mb-4 text-yellow-400" />
        <h2 className="mb-2 text-xl font-semibold text-white">Authentication Required</h2>
        <p className="max-w-lg mb-6 text-sm text-gray-400">{authError}</p>
        <button
          type="button"
          onClick={() => authorize()}
          className="px-6 py-2 text-sm font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
        >
          Sign Message to Login
        </button>
      </div>
    );
  }

  if (isAuthorizing || (normalizedAddress && verifiedWallet !== normalizedAddress)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Loader2 className="w-12 h-12 mb-6 text-cyan-400 animate-spin" />
        <h2 className="mb-2 text-xl font-semibold text-white">Authenticating Wallet Signature</h2>
        <p className="text-sm text-gray-400">Please sign the login message in your wallet to continue.</p>
      </div>
    );
  }

  return <>{children}</>;
}
