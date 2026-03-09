"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import {
  clearAuthSession,
  getStoredAuthSession,
  requestAuthChallenge,
  storeAuthSession,
  verifyAuthSignature,
} from "@/utils/authSession";

export default function WalletAuthGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);

  const normalizedAddress = useMemo(() => address?.toLowerCase() || null, [address]);

  useEffect(() => {
    if (!isConnected || !address) {
      clearAuthSession();
      setVerifiedWallet(null);
      setAuthError(null);
      setIsAuthorizing(false);
      return;
    }

    let cancelled = false;

    const authorize = async () => {
      setIsAuthorizing(true);
      setAuthError(null);

      try {
        const existing = getStoredAuthSession();
        if (existing && existing.wallet === address.toLowerCase()) {
          if (!cancelled) {
            setVerifiedWallet(existing.wallet);
            setIsAuthorizing(false);
          }
          return;
        }

        const challenge = await requestAuthChallenge(address);
        const signature = await signMessageAsync({
          message: challenge.message,
        });

        const verified = await verifyAuthSignature(address, challenge.nonce, signature);
        storeAuthSession(verified.token, verified.wallet, verified.expiresInSec);

        if (!cancelled) {
          setVerifiedWallet(verified.wallet.toLowerCase());
          setIsAuthorizing(false);
        }
      } catch (error) {
        if (!cancelled) {
          clearAuthSession();
          setVerifiedWallet(null);
          setIsAuthorizing(false);
          setAuthError(error instanceof Error ? error.message : "Wallet signature authentication failed");
        }
      }
    };

    void authorize();

    return () => {
      cancelled = true;
    };
  }, [address, isConnected, retryCount, signMessageAsync]);

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

  if (isAuthorizing || (normalizedAddress && verifiedWallet !== normalizedAddress)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Loader2 className="w-12 h-12 mb-6 text-cyan-400 animate-spin" />
        <h2 className="mb-2 text-xl font-semibold text-white">Authenticating Wallet Signature</h2>
        <p className="text-sm text-gray-400">Please sign the login message in your wallet to continue.</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <ShieldCheck className="w-12 h-12 mb-4 text-yellow-400" />
        <h2 className="mb-2 text-xl font-semibold text-white">Wallet Authentication Failed</h2>
        <p className="max-w-lg mb-6 text-sm text-gray-400">{authError}</p>
        <button
          type="button"
          onClick={() => setRetryCount((prev) => prev + 1)}
          className="px-6 py-2 text-sm font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400"
        >
          Retry Signature Login
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
