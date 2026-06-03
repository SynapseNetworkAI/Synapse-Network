"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/WalletAuthGuard";
import OAuthAuthAction from "@/components/oauth/OAuthAuthAction";
import OAuthCredentialPicker from "@/components/oauth/OAuthCredentialPicker";
import OAuthRequestSummary from "@/components/oauth/OAuthRequestSummary";
import { oauthAuthorizeCopy as copy } from "@/components/oauth/oauthAuthorizeCopy";
import type { OAuthParams } from "@/components/oauth/oauthAuthorizeTypes";
import { useOAuthAuthorizeController } from "@/components/oauth/useOAuthAuthorizeController";

const DEFAULT_SCOPE = "synapse.discovery.read synapse.receipts.read offline_access";

export default function OAuthAuthorizeContent() {
  const searchParams = useSearchParams();
  const auth = useAuth();
  const controller = useOAuthAuthorizeController(auth.address, auth.isSessionAuthenticated);

  const oauthParams = useMemo(() => readOAuthParams(searchParams), [searchParams]);
  const requestedScopes = useMemo(() => oauthParams.scope.split(/\s+/).filter(Boolean), [oauthParams.scope]);
  const missingProtocolParams = hasMissingProtocolParams(oauthParams);
  const canApprove = canApproveOAuth(auth.isSessionAuthenticated, controller.selectedCredentialId, missingProtocolParams);

  return (
    <section className="min-h-[calc(100vh-80px)] bg-[#060b10] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-7">
          <PageHeader />
          <BoundaryNotice />
          <OAuthAuthAction {...auth} />
          {auth.isSessionAuthenticated ? (
            <OAuthCredentialPicker
              credentials={controller.credentials}
              selectedCredentialId={controller.selectedCredentialId}
              isLoading={controller.isLoading}
              onSelect={controller.setSelectedCredentialId}
              onCreate={controller.createCredential}
            />
          ) : null}
        </div>
        <OAuthRequestSummary
          oauthParams={oauthParams}
          requestedScopes={requestedScopes}
          missingProtocolParams={missingProtocolParams}
          error={controller.error}
          canApprove={canApprove}
          isApproving={controller.isApproving}
          onApprove={() => controller.approve(oauthParams)}
        />
      </div>
    </section>
  );
}

function readOAuthParams(searchParams: ReturnType<typeof useSearchParams>): OAuthParams {
  return {
    client_id: queryParam(searchParams, "client_id", "chatgpt-custom-mcp"),
    redirect_uri: queryParam(searchParams, "redirect_uri", ""),
    response_type: queryParam(searchParams, "response_type", "code"),
    scope: queryParam(searchParams, "scope", DEFAULT_SCOPE),
    state: queryParam(searchParams, "state", undefined),
    code_challenge: queryParam(searchParams, "code_challenge", ""),
    code_challenge_method: queryParam(searchParams, "code_challenge_method", ""),
    resource: queryParam(searchParams, "resource", undefined),
  };
}

function queryParam(searchParams: ReturnType<typeof useSearchParams>, key: string, fallback: string): string;
function queryParam(searchParams: ReturnType<typeof useSearchParams>, key: string, fallback: undefined): string | undefined;
function queryParam(searchParams: ReturnType<typeof useSearchParams>, key: string, fallback: string | undefined) {
  return searchParams?.get(key) || fallback;
}

function hasMissingProtocolParams(oauthParams: OAuthParams): boolean {
  return !oauthParams.redirect_uri || !oauthParams.code_challenge || oauthParams.code_challenge_method !== "S256";
}

function canApproveOAuth(isSessionAuthenticated: boolean, selectedCredentialId: string, missingProtocolParams: boolean): boolean {
  return isSessionAuthenticated && Boolean(selectedCredentialId) && !missingProtocolParams;
}

function PageHeader() {
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">{copy.eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{copy.title}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">{copy.description}</p>
    </div>
  );
}

function BoundaryNotice() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 h-5 w-5 text-emerald-300" />
        <div>
          <h2 className="text-base font-semibold">{copy.boundaryTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{copy.boundaryDescription}</p>
        </div>
      </div>
    </div>
  );
}
