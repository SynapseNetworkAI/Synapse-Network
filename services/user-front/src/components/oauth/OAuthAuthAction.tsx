"use client";

import { KeyRound, Loader2 } from "lucide-react";
import SupportedWalletConnectButton from "@/components/SupportedWalletConnectButton";
import { oauthAuthorizeCopy as copy } from "@/components/oauth/oauthAuthorizeCopy";

type OAuthAuthActionProps = {
  isConnected: boolean;
  isSessionAuthenticated: boolean;
  isAuthorizing: boolean;
  authorize: () => Promise<boolean>;
};

export default function OAuthAuthAction({
  isConnected,
  isSessionAuthenticated,
  isAuthorizing,
  authorize,
}: Readonly<OAuthAuthActionProps>) {
  if (!isConnected) {
    return (
      <div className="max-w-sm">
        <SupportedWalletConnectButton />
      </div>
    );
  }
  if (isSessionAuthenticated) return null;
  return (
    <button
      type="button"
      onClick={() => authorize()}
      disabled={isAuthorizing}
      className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isAuthorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
      {copy.signIn}
    </button>
  );
}
