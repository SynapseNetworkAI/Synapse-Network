"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/components/WalletAuthGuard";
import SupportedWalletConnectButton from "@/components/SupportedWalletConnectButton";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  approveOAuthAuthorization,
  issueChatGptMcpCredential,
  listOAuthAgentCredentials,
} from "@/utils/oauthApi";
import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";

type OAuthParams = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state?: string;
  code_challenge: string;
  code_challenge_method: string;
  resource?: string;
};

const DEFAULT_SCOPE =
  "synapse.discovery.read synapse.receipts.read offline_access";

export default function OAuthAuthorizeContent() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const {
    address,
    isConnected,
    isSessionAuthenticated,
    isAuthorizing,
    authorize,
  } = useAuth();
  const [credentials, setCredentials] = useState<AgentCredentialRecord[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oauthParams = useMemo<OAuthParams>(
    () => ({
      client_id: searchParams?.get("client_id") || "chatgpt-custom-mcp",
      redirect_uri: searchParams?.get("redirect_uri") || "",
      response_type: searchParams?.get("response_type") || "code",
      scope: searchParams?.get("scope") || DEFAULT_SCOPE,
      state: searchParams?.get("state") || undefined,
      code_challenge: searchParams?.get("code_challenge") || "",
      code_challenge_method: searchParams?.get("code_challenge_method") || "",
      resource: searchParams?.get("resource") || undefined,
    }),
    [searchParams]
  );

  const requestedScopes = useMemo(
    () => oauthParams.scope.split(/\s+/).filter(Boolean),
    [oauthParams.scope]
  );

  const missingProtocolParams =
    !oauthParams.redirect_uri ||
    !oauthParams.code_challenge ||
    oauthParams.code_challenge_method !== "S256";

  const loadCredentials = useCallback(async () => {
    if (!address || !isSessionAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const rows = await listOAuthAgentCredentials(address);
      setCredentials(rows);
      setSelectedCredentialId((current) => current || rows[0]?.id || "");
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : t("oauthAuthorizePage.loadFailed");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [address, isSessionAuthenticated, t]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const handleCreateCredential = async () => {
    if (!address) return;
    setIsLoading(true);
    setError(null);
    try {
      const credential = await issueChatGptMcpCredential(address);
      setCredentials((current) => [credential, ...current]);
      setSelectedCredentialId(credential.id);
      toast.success(t("oauthAuthorizePage.credentialCreated"));
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : t("oauthAuthorizePage.createFailed");
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!address || !selectedCredentialId || missingProtocolParams) return;
    setIsApproving(true);
    setError(null);
    try {
      const redirectUrl = await approveOAuthAuthorization(address, {
        ...oauthParams,
        credentialId: selectedCredentialId,
      });
      window.location.href = redirectUrl;
    } catch (approveError) {
      const message =
        approveError instanceof Error
          ? approveError.message
          : t("oauthAuthorizePage.approveFailed");
      setError(message);
      toast.error(message);
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <section className="min-h-[calc(100vh-80px)] bg-[#060b10] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-7">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
              {t("oauthAuthorizePage.eyebrow")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
              {t("oauthAuthorizePage.title")}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
              {t("oauthAuthorizePage.description")}
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 h-5 w-5 text-emerald-300" />
              <div>
                <h2 className="text-base font-semibold">
                  {t("oauthAuthorizePage.boundaryTitle")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {t("oauthAuthorizePage.boundaryDescription")}
                </p>
              </div>
            </div>
          </div>

          {!isConnected ? (
            <div className="max-w-sm">
              <SupportedWalletConnectButton />
            </div>
          ) : !isSessionAuthenticated ? (
            <button
              type="button"
              onClick={() => authorize()}
              disabled={isAuthorizing}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAuthorizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {t("oauthAuthorizePage.signIn")}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {t("oauthAuthorizePage.selectCredential")}
                </h2>
                <button
                  type="button"
                  onClick={handleCreateCredential}
                  disabled={isLoading}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {t("oauthAuthorizePage.createCredential")}
                </button>
              </div>

              <div className="grid gap-3">
                {credentials.map((credential) => (
                  <label
                    key={credential.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                      selectedCredentialId === credential.id
                        ? "border-emerald-300 bg-emerald-300/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    }`}
                  >
                    <input
                      type="radio"
                      name="credential"
                      value={credential.id}
                      checked={selectedCredentialId === credential.id}
                      onChange={() => setSelectedCredentialId(credential.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {credential.name || t("oauthAuthorizePage.unnamedCredential")}
                      </span>
                      <span className="mt-1 block break-all text-xs text-slate-400">
                        {credential.id}
                      </span>
                      <span className="mt-2 block text-xs text-slate-300">
                        {t("oauthAuthorizePage.credentialLimits")
                          .replace("{{maxCalls}}", String(credential.maxCalls ?? "-"))
                          .replace("{{rpm}}", String(credential.rpm ?? "-"))
                          .replace("{{creditLimit}}", String(credential.creditLimit ?? "-"))}
                      </span>
                    </span>
                  </label>
                ))}
                {!isLoading && credentials.length === 0 ? (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
                    {t("oauthAuthorizePage.emptyCredentials")}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-white/10 bg-[#0d151d] p-5">
          <h2 className="text-base font-semibold">
            {t("oauthAuthorizePage.requestTitle")}
          </h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-slate-400">{t("oauthAuthorizePage.client")}</dt>
              <dd className="mt-1 break-all text-slate-100">{oauthParams.client_id}</dd>
            </div>
            <div>
              <dt className="text-slate-400">{t("oauthAuthorizePage.resource")}</dt>
              <dd className="mt-1 break-all text-slate-100">
                {oauthParams.resource || "https://mcp.synapse-network.ai/mcp"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">{t("oauthAuthorizePage.scopes")}</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {requestedScopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-slate-200"
                  >
                    {scope}
                  </span>
                ))}
              </dd>
            </div>
          </dl>

          {missingProtocolParams ? (
            <p className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
              {t("oauthAuthorizePage.invalidRequest")}
            </p>
          ) : null}
          {error ? (
            <p className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleApprove}
            disabled={
              !isSessionAuthenticated ||
              !selectedCredentialId ||
              missingProtocolParams ||
              isApproving
            }
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {t("oauthAuthorizePage.approve")}
          </button>
        </aside>
      </div>
    </section>
  );
}
