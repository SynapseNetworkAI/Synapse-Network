"use client";

import { Bot, Check, Copy, Play, Rocket } from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";
import type { FirstInvocationResult } from "@/components/dashboard/agents/FirstInvocationPanel";

type SandboxControlsProps = {
  credential: string;
  onCredentialChange: (value: string) => void;
  onPersistCredential: () => void;
  onRunExample: (payloadText: string) => void;
  isInvoking: boolean;
  error?: string | null;
  invokeError?: string | null;
  payloadDraft: string;
  onPayloadDraftChange: (value: string) => void;
  selectedService?: ServiceRegistryRecord;
  copiedItem: string | null;
  onCopy: (text: string, id: string) => void;
};

export function SandboxHeader() {
  const { t } = useLanguage();

  return (
    <header className="flex items-start gap-3">
      <span
        className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3"
        aria-hidden="true"
      >
        <Rocket className="h-5 w-5 text-amber-300" />
      </span>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-300/80">
          {t("agentsPage.sandboxInvocationEyebrow")}
        </p>
        <h3 className="mt-2 text-xl font-semibold text-white">
          {t("agentsPage.sandboxInvocationTitle")}
        </h3>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          {t("agentsPage.sandboxInvocationDescription")}
        </p>
      </div>
    </header>
  );
}

export function SandboxControls({
  credential,
  onCredentialChange,
  onPersistCredential,
  onRunExample,
  isInvoking,
  error,
  invokeError,
  payloadDraft,
  onPayloadDraftChange,
  selectedService,
  copiedItem,
  onCopy,
}: Readonly<SandboxControlsProps>) {
  const { t } = useLanguage();

  return (
    <div className="mt-6 space-y-4">
      <label htmlFor="sandbox-credential" className="block space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">
          {t("agentsPage.agentCredentialLabel")}
        </span>
        <textarea
          id="sandbox-credential"
          value={credential}
          onChange={(event) => onCredentialChange(event.target.value)}
          rows={3}
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-xs text-emerald-300 outline-none transition focus:border-emerald-400/40"
          placeholder={t("agentsPage.agentCredentialPlaceholder")}
        />
      </label>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPersistCredential}
          disabled={!selectedService || !credential.trim()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.22em] text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Bot className="h-4 w-4" />
          {t("agentsPage.saveForService")}
        </button>
        <button
          type="button"
          onClick={() => onCopy(payloadDraft, "payload")}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.22em] text-white transition hover:bg-white/10"
        >
          {copiedItem === "payload" ? (
            <Check className="h-4 w-4 text-emerald-300" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {t("agentsPage.copyPayload")}
        </button>
      </div>

      <label htmlFor="sandbox-payload" className="block space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">
          {t("agentsPage.invokePayloadLabel")}
        </span>
        <textarea
          id="sandbox-payload"
          value={payloadDraft}
          onChange={(event) => onPayloadDraftChange(event.target.value)}
          rows={10}
          className="w-full rounded-[24px] border border-white/10 bg-[#050b16] px-4 py-4 font-mono text-xs leading-6 text-blue-200 outline-none transition focus:border-blue-400/40"
        />
      </label>

      {error && <p className="text-sm text-amber-300">{error}</p>}
      {invokeError && <p className="text-sm text-red-300">{invokeError}</p>}

      <button
        type="button"
        onClick={() => onRunExample(payloadDraft)}
        disabled={isInvoking || !selectedService}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-400 px-4 py-4 text-xs font-bold uppercase tracking-[0.24em] text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play className="h-4 w-4" />
        {isInvoking
          ? t("agentsPage.processingPaymentAndInvoke")
          : t("agentsPage.runPaidExample")}
      </button>
    </div>
  );
}

export function InvocationResultPanel({
  result,
}: Readonly<{ result?: FirstInvocationResult | null }>) {
  const { t } = useLanguage();

  return (
    <section className="mt-6 rounded-[24px] border border-white/10 bg-black/20 p-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">
        {t("agentsPage.resultLabel")}
      </p>
      {result ? (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-3 md:grid-cols-2">
            <ResultStat
              label={t("agentsPage.resultServiceLabel")}
              value={result.serviceName}
            />
            <ResultStat
              label={t("agentsPage.resultChargedLabel")}
              value={`${result.chargedUsdc} USDC`}
              valueClassName="text-emerald-300"
            />
            <ResultStat
              label={t("agentsPage.resultAttemptsLabel")}
              value={String(result.attempts)}
            />
            <ResultStat
              label={t("agentsPage.resultLatencyLabel")}
              value={`${result.durationMs} ms`}
            />
          </dl>

          <ResultTextBlock
            label={t("agentsPage.resultTransactionHashLabel")}
            value={result.txHash}
            valueClassName="text-blue-300"
          />
          <ResultTextBlock
            label={t("agentsPage.resultRequestIdLabel")}
            value={
              result.requestId || t("agentsPage.unavailableInGatewayResponse")
            }
            valueClassName="text-white"
          />

          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-white/8 bg-[#050b16] p-4 font-mono text-xs leading-6 text-emerald-200">
            <code>{JSON.stringify(result.response, null, 2)}</code>
          </pre>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-gray-400">
          {t("agentsPage.noInvocationYet")}
        </p>
      )}
    </section>
  );
}

function ResultStat({
  label,
  value,
  valueClassName = "text-white",
}: Readonly<{ label: string; value: string; valueClassName?: string }>) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">
        {label}
      </dt>
      <dd className={`mt-2 text-sm font-semibold ${valueClassName}`}>
        {value}
      </dd>
    </div>
  );
}

function ResultTextBlock({
  label,
  value,
  valueClassName,
}: Readonly<{ label: string; value: string; valueClassName: string }>) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">
        {label}
      </p>
      <p className={`mt-2 break-all font-mono text-xs ${valueClassName}`}>
        {value}
      </p>
    </div>
  );
}
