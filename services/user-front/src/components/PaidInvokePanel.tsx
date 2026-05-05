"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import type { Address } from "viem";
import { invokePaidService } from "@/utils/invokePaidService";
import { payForServiceWithApproval } from "@/utils/payForService";
import { getCredentialForService } from "@/utils/agentCredentialStore";
import { useLanguage } from "@/components/i18n/LanguageProvider";

type PaidInvokePanelProps = {
  providerAddress: string;
  serviceId?: string;
  pricing?: string;
  endpoint?: string;
  isActive?: boolean;
  title?: string;
  compact?: boolean;
  defaultCollapsed?: boolean;
};

type InvokeResultState = {
  txHash: string;
  attempts: number;
  response: string;
};

type ExpandedInvokeContentProps = {
  canInvoke: boolean;
  compact: boolean;
  isInvoking: boolean;
  lastResult: InvokeResultState;
  onInvoke: () => void;
  serviceId?: string;
  testPrompt: string;
  setTestPrompt: (value: string) => void;
  copy: PaidInvokeCopy;
};

type PaidInvokeActionArgs = {
  endpoint?: string;
  isActive: boolean;
  pricing?: string;
  providerAddress: string;
  serviceId?: string;
  testPrompt: string;
  copy: PaidInvokeCopy;
};

type PaidInvokeCopy = {
  missingConfig: string;
  inactiveService: string;
  completed: string;
  failed: string;
  txHash: string;
  attempts: string;
  testPrompt: string;
  processing: string;
  payAndInvoke: string;
  unavailableHint: string;
  collapse: string;
  expand: string;
  collapsedHint: string;
};

const EMPTY_RESULT: InvokeResultState = {
  txHash: "",
  attempts: 0,
  response: "",
};

function usePaidInvokeAction({
  endpoint,
  isActive,
  pricing,
  providerAddress,
  serviceId,
  testPrompt,
  copy,
}: Readonly<PaidInvokeActionArgs>) {
  const [isInvoking, setIsInvoking] = useState(false);
  const [lastResult, setLastResult] = useState<InvokeResultState>(EMPTY_RESULT);

  const handleTestPaidInvoke = async () => {
    if (!endpoint || !serviceId || !pricing) {
      toast.error(copy.missingConfig);
      return;
    }
    if (!isActive) {
      toast.error(copy.inactiveService);
      return;
    }

    setIsInvoking(true);
    setLastResult(EMPTY_RESULT);

    try {
      const result = await invokePaidService({
        endpoint,
        serviceId,
        payload: {
          prompt: testPrompt,
          service_id: serviceId,
        },
        credential: getCredentialForService(serviceId),
        payForService: async () =>
          payForServiceWithApproval({
            provider: providerAddress as Address,
            serviceId,
            priceUsdc: pricing,
          }),
        maxWaitMs: 60_000,
        defaultRetryAfterMs: 2_000,
        maxAttempts: 20,
      });

      setLastResult({
        txHash: result.txHash,
        attempts: result.attempts,
        response: JSON.stringify(result.response, null, 2),
      });
      toast.success(copy.completed);
    } catch (error) {
      console.error("Paid invoke failed:", error);
      toast.error(copy.failed);
    } finally {
      setIsInvoking(false);
    }
  };

  return { handleTestPaidInvoke, isInvoking, lastResult };
}

function InvokeResultDetails({
  attempts,
  txHash,
  copy,
}: Readonly<{ attempts: number; txHash: string; copy: PaidInvokeCopy }>) {
  if (!txHash) return null;

  return (
    <div className="p-3 text-xs border border-gray-800 rounded-lg bg-gray-950">
      <div className="text-gray-500">{copy.txHash}</div>
      <div className="font-mono text-green-300 break-all">{txHash}</div>
      <div className="mt-2 text-gray-500">{copy.attempts}</div>
      <div className="font-mono text-green-300">{attempts}</div>
    </div>
  );
}

function InvokeResponsePreview({
  compact,
  response,
}: Readonly<{ compact: boolean; response: string }>) {
  if (!response) return null;

  return (
    <textarea
      value={response}
      readOnly
      className={`w-full p-3 font-mono text-xs text-green-300 border border-gray-800 rounded-lg bg-gray-950 ${
        compact ? "h-28" : "h-40"
      }`}
    />
  );
}

function ExpandedInvokeContent({
  canInvoke,
  compact,
  isInvoking,
  lastResult,
  onInvoke,
  serviceId,
  testPrompt,
  setTestPrompt,
  copy,
}: Readonly<ExpandedInvokeContentProps>) {
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor={`test-prompt-${serviceId || "service"}`}
          className="block mb-1 text-xs text-gray-500 uppercase"
        >
          {copy.testPrompt}
        </label>
        <input
          id={`test-prompt-${serviceId || "service"}`}
          type="text"
          value={testPrompt}
          onChange={(e) => setTestPrompt(e.target.value)}
          className="w-full px-3 py-2 font-mono text-sm text-white bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500"
        />
      </div>
      <button
        type="button"
        onClick={onInvoke}
        disabled={isInvoking || !canInvoke}
        className="w-full py-2 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isInvoking ? copy.processing : copy.payAndInvoke}
      </button>

      {!canInvoke && (
        <p className="text-xs text-yellow-500">{copy.unavailableHint}</p>
      )}

      <InvokeResultDetails
        attempts={lastResult.attempts}
        txHash={lastResult.txHash}
        copy={copy}
      />
      <InvokeResponsePreview compact={compact} response={lastResult.response} />
    </div>
  );
}

export default function PaidInvokePanel({
  providerAddress,
  serviceId,
  pricing,
  endpoint,
  isActive = true,
  title,
  compact = false,
  defaultCollapsed = false,
}: Readonly<PaidInvokePanelProps>) {
  const { t } = useLanguage();
  const copy: PaidInvokeCopy = {
    missingConfig: t("paidInvokePanel.missingConfig"),
    inactiveService: t("paidInvokePanel.inactiveService"),
    completed: t("paidInvokePanel.completed"),
    failed: t("paidInvokePanel.failed"),
    txHash: t("paidInvokePanel.txHash"),
    attempts: t("paidInvokePanel.attempts"),
    testPrompt: t("paidInvokePanel.testPrompt"),
    processing: t("paidInvokePanel.processing"),
    payAndInvoke: t("paidInvokePanel.payAndInvoke"),
    unavailableHint: t("paidInvokePanel.unavailableHint"),
    collapse: t("paidInvokePanel.collapse"),
    expand: t("paidInvokePanel.expand"),
    collapsedHint: t("paidInvokePanel.collapsedHint"),
  };
  const [testPrompt, setTestPrompt] = useState(
    t("paidInvokePanel.defaultPrompt")
  );
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const canInvoke = Boolean(endpoint && serviceId && pricing && isActive);
  const { handleTestPaidInvoke, isInvoking, lastResult } = usePaidInvokeAction({
    endpoint,
    isActive,
    pricing,
    providerAddress,
    serviceId,
    testPrompt,
    copy,
  });

  return (
    <div
      className={`p-6 border border-gray-800 rounded-2xl bg-black/60 ${
        compact ? "p-4" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold tracking-widest text-white uppercase">
          {title ?? t("paidInvokePanel.defaultTitle")}
        </h3>
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="text-xs text-gray-400 transition-colors hover:text-white"
        >
          {isExpanded ? copy.collapse : copy.expand}
        </button>
      </div>

      {!isExpanded && (
        <p className="text-xs text-gray-500">{copy.collapsedHint}</p>
      )}

      {isExpanded && (
        <ExpandedInvokeContent
          canInvoke={canInvoke}
          compact={compact}
          isInvoking={isInvoking}
          lastResult={lastResult}
          onInvoke={handleTestPaidInvoke}
          serviceId={serviceId}
          setTestPrompt={setTestPrompt}
          testPrompt={testPrompt}
          copy={copy}
        />
      )}
    </div>
  );
}
