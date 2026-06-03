"use client";

import { KeyRound, Loader2 } from "lucide-react";
import type { AgentCredentialRecord } from "@/utils/agentCredentialApi";
import { oauthAuthorizeCopy as copy } from "@/components/oauth/oauthAuthorizeCopy";

type OAuthCredentialPickerProps = {
  credentials: AgentCredentialRecord[];
  selectedCredentialId: string;
  isLoading: boolean;
  onSelect: (credentialId: string) => void;
  onCreate: () => void;
};

export default function OAuthCredentialPicker({
  credentials,
  selectedCredentialId,
  isLoading,
  onSelect,
  onCreate,
}: Readonly<OAuthCredentialPickerProps>) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{copy.selectCredential}</h2>
        <button
          type="button"
          onClick={onCreate}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {copy.createCredential}
        </button>
      </div>
      <div className="grid gap-3">
        {credentials.map((credential) => (
          <CredentialOption
            key={credential.id}
            credential={credential}
            isSelected={selectedCredentialId === credential.id}
            onSelect={onSelect}
          />
        ))}
        {!isLoading && credentials.length === 0 ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            {copy.emptyCredentials}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CredentialOption({
  credential,
  isSelected,
  onSelect,
}: Readonly<{
  credential: AgentCredentialRecord;
  isSelected: boolean;
  onSelect: (credentialId: string) => void;
}>) {
  const limits = copy.credentialLimits
    .replace("{{maxCalls}}", String(credential.maxCalls ?? "-"))
    .replace("{{rpm}}", String(credential.rpm ?? "-"))
    .replace("{{creditLimit}}", String(credential.creditLimit ?? "-"));
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
        isSelected ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"
      }`}
    >
      <input
        type="radio"
        name="credential"
        value={credential.id}
        checked={isSelected}
        onChange={() => onSelect(credential.id)}
        className="mt-1"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{credential.name || copy.unnamedCredential}</span>
        <span className="mt-1 block break-all text-xs text-slate-400">{credential.id}</span>
        <span className="mt-2 block text-xs text-slate-300">{limits}</span>
      </span>
    </label>
  );
}
