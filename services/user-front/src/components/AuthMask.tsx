"use client";

import Link from "next/link";
import { useAuth } from "@/components/WalletAuthGuard";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import SupportedWalletConnectButton from "@/components/SupportedWalletConnectButton";

interface AuthMaskProps {
  children: ReactNode;
  allowChallengeAuthorize?: boolean;
  allowSessionAuthorize?: boolean;
  autoAuthorizeOnConnect?: boolean;
  sessionHelpText?: string;
  sessionRecoveryHref?: string;
  sessionRecoveryLabel?: string;
}

type AuthMaskPromptProps = Pick<
  AuthMaskProps,
  | "allowChallengeAuthorize"
  | "allowSessionAuthorize"
  | "sessionHelpText"
  | "sessionRecoveryHref"
  | "sessionRecoveryLabel"
> & {
  authError?: string | null;
  isAuthorizing: boolean;
  isConnected: boolean;
  authorize: () => void | Promise<unknown>;
};

function ConnectWalletPrompt() {
  return (
    <>
      <Wallet className="w-12 h-12 mb-4 text-green-400 opacity-80" />
      <h3 className="text-xl font-bold text-white mb-2">Connect Wallet</h3>
      <p className="text-gray-400 text-sm mb-6">
        Please connect your wallet to view and manage your data.
      </p>
      <div onClick={(e) => e.stopPropagation()}>
        <SupportedWalletConnectButton />
      </div>
    </>
  );
}

function AuthenticatingPrompt() {
  return (
    <>
      <Loader2 className="w-12 h-12 mb-4 text-cyan-400 animate-spin" />
      <h3 className="text-xl font-bold text-white mb-2">Authenticating</h3>
      <p className="text-gray-400 text-sm mb-0">
        Please sign the message in your wallet to verify your identity.
      </p>
    </>
  );
}

function ChallengePrompt({
  authError,
  authorize,
}: Readonly<Pick<AuthMaskPromptProps, "authError" | "authorize">>) {
  return (
    <>
      <h3 className="text-xl font-bold text-white mb-2">Signature Required</h3>
      <p className="text-gray-400 text-sm mb-6">
        {authError ||
          "Please sign the message to verify your identity and access your full dashboard."}
      </p>
      <button
        type="button"
        onClick={() => authorize()}
        className="px-6 py-2.5 text-sm font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
      >
        Sign to Verify
      </button>
    </>
  );
}

function SessionPrompt({
  allowSessionAuthorize,
  authError,
  authorize,
  sessionHelpText,
  sessionRecoveryHref,
  sessionRecoveryLabel,
}: Readonly<
  Pick<
    AuthMaskPromptProps,
    | "allowSessionAuthorize"
    | "authError"
    | "authorize"
    | "sessionHelpText"
    | "sessionRecoveryHref"
    | "sessionRecoveryLabel"
  >
>) {
  return (
    <>
      <h3 className="text-xl font-bold text-white mb-2">Session Required</h3>
      <p className="text-gray-400 text-sm mb-0">
        {authError ||
          sessionHelpText ||
          "An active wallet session is required to access this page. Please complete sign-in from the authentication entry page."}
      </p>
      {allowSessionAuthorize ? (
        <button
          type="button"
          onClick={() => authorize()}
          className="mt-5 px-6 py-2.5 text-sm font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
        >
          Sign In Session
        </button>
      ) : null}
      {sessionRecoveryHref ? (
        <Link
          href={sessionRecoveryHref}
          className="mt-5 inline-flex items-center justify-center px-5 py-2 text-sm font-semibold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
        >
          {sessionRecoveryLabel}
        </Link>
      ) : null}
    </>
  );
}

function AuthMaskPrompt({
  allowChallengeAuthorize,
  allowSessionAuthorize,
  authError,
  authorize,
  isAuthorizing,
  isConnected,
  sessionHelpText,
  sessionRecoveryHref,
  sessionRecoveryLabel,
}: Readonly<AuthMaskPromptProps>) {
  if (!isConnected) {
    return <ConnectWalletPrompt />;
  }
  if (isAuthorizing) {
    return <AuthenticatingPrompt />;
  }

  return (
    <>
      <ShieldCheck className="w-12 h-12 mb-4 text-yellow-400 opacity-80" />
      {allowChallengeAuthorize ? (
        <ChallengePrompt authError={authError} authorize={authorize} />
      ) : (
        <SessionPrompt
          allowSessionAuthorize={allowSessionAuthorize}
          authError={authError}
          authorize={authorize}
          sessionHelpText={sessionHelpText}
          sessionRecoveryHref={sessionRecoveryHref}
          sessionRecoveryLabel={sessionRecoveryLabel}
        />
      )}
    </>
  );
}

export default function AuthMask({
  children,
  allowChallengeAuthorize = true,
  allowSessionAuthorize = true,
  autoAuthorizeOnConnect = true,
  sessionHelpText,
  sessionRecoveryHref,
  sessionRecoveryLabel = "Go to Sign-In",
}: Readonly<AuthMaskProps>) {
  const {
    isConnected,
    isSessionAuthenticated,
    address,
    authError,
    isAuthorizing,
    authorize,
  } = useAuth();

  const autoTriedWalletRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoAuthorizeOnConnect) return;

    if (!isConnected || !address) {
      autoTriedWalletRef.current = null;
      return;
    }

    if (isSessionAuthenticated || isAuthorizing) return;

    if (!allowChallengeAuthorize && !allowSessionAuthorize) return;

    const normalized = address.toLowerCase();
    if (autoTriedWalletRef.current === normalized) return;

    autoTriedWalletRef.current = normalized;
    void authorize();
  }, [
    autoAuthorizeOnConnect,
    isConnected,
    address,
    isSessionAuthenticated,
    isAuthorizing,
    allowChallengeAuthorize,
    allowSessionAuthorize,
    authorize,
  ]);

  const isMasked = !isConnected || !isSessionAuthenticated;

  return (
    <div className="relative relative-group">
      {/* 
        The underlying content is ALWAYS rendered 
        so the shell/structure is visible behind the blur 
      */}
      <div
        className={`${
          isMasked ? "blur-sm select-none pointer-events-none opacity-50" : ""
        } transition-all duration-300`}
      >
        {children}
      </div>

      {isMasked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/10 backdrop-blur-[2px] rounded-xl">
          <div className="bg-[#1a1a1a] border border-[#333] p-8 rounded-2xl shadow-2xl max-w-md text-center flex flex-col items-center">
            <AuthMaskPrompt
              allowChallengeAuthorize={allowChallengeAuthorize}
              allowSessionAuthorize={allowSessionAuthorize}
              authError={authError}
              authorize={authorize}
              isAuthorizing={isAuthorizing}
              isConnected={isConnected}
              sessionHelpText={sessionHelpText}
              sessionRecoveryHref={sessionRecoveryHref}
              sessionRecoveryLabel={sessionRecoveryLabel}
            />
          </div>
        </div>
      )}
    </div>
  );
}
