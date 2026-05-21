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
  useChainId,
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
import { showWalletStatusToast } from "@/utils/walletToast";
import { createWalletUserRejectedError } from "@/utils/walletActionErrors";
import {
  getInjectedEthereumProvider,
  getWalletCompatibilityMessage,
} from "@/utils/walletCompatibility";
import { ensureWalletOnRuntimeChain } from "@/utils/walletNetwork";
import { getRuntimeEnvironmentConfig } from "@/utils/runtimeEnv";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import WalletActionIntentDialog from "@/components/wallet/WalletActionIntentDialog";
import {
  AuthContextType,
  handleWalletAuthFailure,
  LoginIntentState,
  readLocalE2eWalletAddress,
} from "@/components/walletAuthGuardShared";

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
export default function WalletAuthGuard({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { isConnected, address, connector } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { t } = useLanguage();
  const [localE2eWallet, setLocalE2eWallet] = useState<string | null>(null);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);
  const [loginIntent, setLoginIntent] = useState<LoginIntentState | null>(null);
  const disconnectClearTimer = useRef<ReturnType<
    typeof globalThis.setTimeout
  > | null>(null);
  const pendingAutoAuthorizeWalletRef = useRef<string | null>(null);
  const autoAuthorizeTriedWalletRef = useRef<string | null>(null);
  const authorizePromiseRef = useRef<Promise<boolean> | null>(null);
  const loginIntentResolverRef = useRef<((approved: boolean) => void) | null>(
    null
  );
  const lastSessionExpiredToastAtRef = useRef(0);
  const effectiveAddress = address || localE2eWallet || undefined;
  const effectiveIsConnected = isConnected || Boolean(localE2eWallet);
  const runtimeEnv = useMemo(() => getRuntimeEnvironmentConfig(), []);

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
      showWalletStatusToast(t("walletActions.sessionExpiredRetry"), {
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
  }, [disconnect, shouldForceReconnectForCurrentRole, isConnected, t]);

  // We no longer block access globally based on isPublicRoute.
  // The context provides auth state to downstream components that use <AuthMask />.

  const signChallengeMessage = useCallback(
    async (challengeMessage: string, walletAddress: string): Promise<string> =>
      signWalletMessage(challengeMessage, walletAddress, signMessageAsync),
    [signMessageAsync]
  );

  const waitForLoginIntentApproval = useCallback(
    (intent: LoginIntentState): Promise<boolean> => {
      setLoginIntent(intent);
      return new Promise((resolve) => {
        loginIntentResolverRef.current = resolve;
      });
    },
    []
  );

  const resolveLoginIntent = useCallback((approved: boolean): void => {
    loginIntentResolverRef.current?.(approved);
    loginIntentResolverRef.current = null;
    setLoginIntent(null);
  }, []);

  const handleAuthorizeFailure = useCallback(
    (error: unknown): void => {
      clearAuthSession();
      setVerifiedWallet(null);
      setIsAuthorizing(false);
      const result = handleWalletAuthFailure(error, t);
      setAuthError(result.authError);
      if (result.shouldForceReconnect) {
        forceReconnectIfNeeded();
      }
    },
    [forceReconnectIfNeeded, t]
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
        const walletCompatibilityMessage = getWalletCompatibilityMessage({
          chainId: runtimeEnv.chainId,
          connectorName: connector?.name,
          connectorId: connector?.id,
          injectedProvider: getInjectedEthereumProvider(),
        });
        if (walletCompatibilityMessage) {
          setAuthError(t("walletActions.walletUnsupportedForArbitrum"));
          setIsAuthorizing(false);
          showWalletStatusToast(
            t("walletActions.walletUnsupportedForArbitrum"),
            {
              icon: "🧭",
            }
          );
          return false;
        }

        if (chainId !== runtimeEnv.chainId) {
          await ensureWalletOnRuntimeChain(runtimeEnv);
        }

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

        const challenge = await requestAuthChallenge(
          effectiveAddress,
          runtimeEnv.chainId
        );
        const challengeMessage = challenge.challenge;
        if (!challengeMessage) {
          throw new Error("Auth challenge missing from server response");
        }

        const approved = await waitForLoginIntentApproval({
          domain: challenge.domain || "synapse-network.ai",
          wallet: effectiveAddress,
          chainId,
        });
        if (!approved) {
          throw createWalletUserRejectedError();
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
    chainId,
    localE2eWallet,
    connector,
    runtimeEnv,
    waitForLoginIntentApproval,
    signChallengeMessage,
    handleAuthorizeFailure,
    t,
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
      setAuthError(t("walletActions.sessionExpiredRetry"));
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
    t,
  ]);

  useEffect(() => {
    const onSessionExpired = () => {
      clearAuthSession();
      setAuthError(t("walletActions.sessionExpiredRetry"));
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
  }, [forceReconnectIfNeeded, t]);

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
      <WalletActionIntentDialog
        open={Boolean(loginIntent)}
        title={t("walletActions.loginTitle")}
        description={t("walletActions.loginDescription")}
        rows={[
          {
            label: t("walletActions.loginPurposeLabel"),
            value: t("walletActions.loginPurposeValue"),
          },
          {
            label: t("walletActions.loginDomainLabel"),
            value: loginIntent?.domain || "-",
          },
          {
            label: t("walletActions.loginWalletLabel"),
            value: loginIntent?.wallet || "-",
          },
          {
            label: t("walletActions.loginNetworkLabel"),
            value: loginIntent?.chainId ? String(loginIntent.chainId) : "-",
          },
          {
            label: t("walletActions.loginNoFundsLabel"),
            value: t("walletActions.loginNoFundsValue"),
          },
        ]}
        checklistTitle={t("walletActions.loginChecklistTitle")}
        checklist={[
          t("walletActions.loginChecklistDomain"),
          t("walletActions.loginChecklistNoFunds"),
          t("walletActions.loginChecklistNonce"),
        ]}
        cancelLabel={t("walletActions.cancel")}
        continueLabel={t("walletActions.continueToWallet")}
        closeLabel={t("walletActions.close")}
        onCancel={() => resolveLoginIntent(false)}
        onContinue={() => resolveLoginIntent(true)}
      />
    </AuthContext.Provider>
  );
}
