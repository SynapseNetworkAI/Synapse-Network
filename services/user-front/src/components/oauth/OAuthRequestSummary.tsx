"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { oauthAuthorizeCopy as copy } from "@/components/oauth/oauthAuthorizeCopy";
import type { OAuthParams } from "@/components/oauth/oauthAuthorizeTypes";

type OAuthRequestSummaryProps = {
  oauthParams: OAuthParams;
  requestedScopes: string[];
  missingProtocolParams: boolean;
  error: string | null;
  canApprove: boolean;
  isApproving: boolean;
  onApprove: () => void;
};

export default function OAuthRequestSummary({
  oauthParams,
  requestedScopes,
  missingProtocolParams,
  error,
  canApprove,
  isApproving,
  onApprove,
}: Readonly<OAuthRequestSummaryProps>) {
  return (
    <aside className="rounded-lg border border-white/10 bg-[#0d151d] p-5">
      <h2 className="text-base font-semibold">{copy.requestTitle}</h2>
      <dl className="mt-5 space-y-4 text-sm">
        <SummaryRow label={copy.client} value={oauthParams.client_id} />
        <SummaryRow label={copy.resource} value={oauthParams.resource || "https://mcp.synapse-network.ai/mcp"} />
        <div>
          <dt className="text-slate-400">{copy.scopes}</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {requestedScopes.map((scope) => (
              <span key={scope} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-slate-200">
                {scope}
              </span>
            ))}
          </dd>
        </div>
      </dl>
      {missingProtocolParams ? <ErrorBox message={copy.invalidRequest} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      <button
        type="button"
        onClick={onApprove}
        disabled={!canApprove || isApproving}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isApproving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {copy.approve}
      </button>
    </aside>
  );
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="mt-1 break-all text-slate-100">{value}</dd>
    </div>
  );
}

function ErrorBox({ message }: Readonly<{ message: string }>) {
  return (
    <p className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
      {message}
    </p>
  );
}
