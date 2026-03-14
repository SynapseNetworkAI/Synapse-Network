"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import type { Address } from "viem";
import { invokePaidService } from "@/utils/invokePaidService";
import { payForServiceWithApproval } from "@/utils/payForService";
import { getCredentialForService } from "@/utils/agentCredentialStore";

type PaidInvokePanelProps = {
  sellerAddress: string;
  serviceId?: string;
  pricing?: string;
  endpoint?: string;
  isActive?: boolean;
  title?: string;
  compact?: boolean;
  defaultCollapsed?: boolean;
};

export default function PaidInvokePanel({
  sellerAddress,
  serviceId,
  pricing,
  endpoint,
  isActive = true,
  title = "Live Test (Pay + Invoke)",
  compact = false,
  defaultCollapsed = false,
}: Readonly<PaidInvokePanelProps>) {
  const [testPrompt, setTestPrompt] = useState("hello from buyer");
  const [isInvoking, setIsInvoking] = useState(false);
  const [lastInvokeTxHash, setLastInvokeTxHash] = useState("");
  const [lastInvokeAttempts, setLastInvokeAttempts] = useState(0);
  const [lastInvokeResponse, setLastInvokeResponse] = useState("");
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  const canInvoke = Boolean(endpoint && serviceId && pricing && isActive);

  const handleTestPaidInvoke = async () => {
    if (!endpoint || !serviceId || !pricing) {
      toast.error("Please complete endpoint, serviceId and pricing first.");
      return;
    }
    if (!isActive) {
      toast.error("Service is INACTIVE. Switch to ACTIVE before testing.");
      return;
    }

    setIsInvoking(true);
    setLastInvokeTxHash("");
    setLastInvokeAttempts(0);
    setLastInvokeResponse("");

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
            seller: sellerAddress as Address,
            serviceId,
            priceUsdc: pricing,
            rpcUrl: "http://127.0.0.1:8545",
          }),
        maxWaitMs: 60_000,
        defaultRetryAfterMs: 2_000,
        maxAttempts: 20,
      });

      setLastInvokeTxHash(result.txHash);
      setLastInvokeAttempts(result.attempts);
      setLastInvokeResponse(JSON.stringify(result.response, null, 2));
      toast.success("Paid invoke completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invoke failed";
      toast.error(message);
    } finally {
      setIsInvoking(false);
    }
  };

  return (
    <div className={`p-6 border border-gray-800 rounded-2xl bg-black/60 ${compact ? "p-4" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold tracking-widest text-white uppercase">{title}</h3>
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="text-xs text-gray-400 transition-colors hover:text-white"
        >
          {isExpanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {!isExpanded && (
        <p className="text-xs text-gray-500">Click Expand to run a paid service invocation test.</p>
      )}

      {isExpanded && (
      <div className="space-y-3">
        <div>
          <label htmlFor={`test-prompt-${serviceId || "service"}`} className="block mb-1 text-xs text-gray-500 uppercase">
            Test Prompt
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
          onClick={handleTestPaidInvoke}
          disabled={isInvoking || !canInvoke}
          className="w-full py-2 text-sm font-bold text-black transition-colors bg-green-500 rounded-lg hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isInvoking ? "Processing..." : "Pay & Invoke Now"}
        </button>

        {!canInvoke && (
          <p className="text-xs text-yellow-500">
            Endpoint / Service ID / Pricing missing or service is inactive.
          </p>
        )}

        {lastInvokeTxHash && (
          <div className="p-3 text-xs border border-gray-800 rounded-lg bg-gray-950">
            <div className="text-gray-500">Tx Hash</div>
            <div className="font-mono text-green-300 break-all">{lastInvokeTxHash}</div>
            <div className="mt-2 text-gray-500">Attempts</div>
            <div className="font-mono text-green-300">{lastInvokeAttempts}</div>
          </div>
        )}

        {lastInvokeResponse && (
          <textarea
            value={lastInvokeResponse}
            readOnly
            className={`w-full p-3 font-mono text-xs text-green-300 border border-gray-800 rounded-lg bg-gray-950 ${compact ? "h-28" : "h-40"}`}
          />
        )}
      </div>
      )}
    </div>
  );
}
