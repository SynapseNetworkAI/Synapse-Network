"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Check, Copy, ExternalLink, Play, Rocket, Terminal } from "lucide-react";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";

type SnippetTab = "typescript" | "python" | "curl";

export type FirstInvocationResult = {
  txHash: string;
  attempts: number;
  durationMs: number;
  chargedUsdc: string;
  serviceName: string;
  requestId: string | null;
  response: unknown;
};

type FirstInvocationPanelProps = {
  services: ServiceRegistryRecord[];
  isLoading: boolean;
  error?: string | null;
  selectedServiceId: string;
  onSelectService: (serviceId: string) => void;
  credential: string;
  onCredentialChange: (value: string) => void;
  onPersistCredential: () => void;
  onRunExample: (payloadText: string) => void;
  isInvoking: boolean;
  invokeError?: string | null;
  result?: FirstInvocationResult | null;
};

function formatPricing(pricing: ServiceRegistryRecord["pricing"]): string {
  if (typeof pricing === "string") {
    return pricing;
  }
  const amount = pricing?.amount ?? 0;
  const currency = pricing?.currency ?? "USDC";
  return `${amount} ${currency}`;
}

function getDefaultPayload(service?: ServiceRegistryRecord): string {
  const example = service?.invoke?.examples?.[0];
  if (example && typeof example === "object") {
    return JSON.stringify(example, null, 2);
  }

  return JSON.stringify(
    {
      prompt: "hello from synapse agent",
      service_id: service?.serviceId ?? "service_id",
    },
    null,
    2,
  );
}

function buildTypescriptSnippet(service?: ServiceRegistryRecord): string {
  return `import { SynapseClient } from "@synapse/sdk";

const client = new SynapseClient({
  credential: process.env.SYNAPSE_AGENT_CREDENTIAL,
});

const services = await client.discovery.search("${service?.role || "data"}");
const quote = await client.quote.get("${service?.serviceId || "service_id"}");
const result = await client.invoke.call(quote.id, ${getDefaultPayload(service)});

console.log(result.data);`;
}

function buildPythonSnippet(service?: ServiceRegistryRecord): string {
  return `from synapse import SynapseClient

client = SynapseClient(credential=os.environ["SYNAPSE_AGENT_CREDENTIAL"])

services = client.discovery.search("${service?.role || "data"}")
quote = client.quote.get("${service?.serviceId || "service_id"}")
result = client.invoke.call(quote["id"], ${getDefaultPayload(service)})

print(result["data"])`;
}

function buildCurlSnippet(service?: ServiceRegistryRecord): string {
  return String.raw`curl -X POST "${service?.endpoint || "https://gateway.example.com/invoke"}" \\
  -H "Content-Type: application/json" \\
  -H "X-Service-Id: ${service?.serviceId || "service_id"}" \\
  -H "X-Credential: $SYNAPSE_AGENT_CREDENTIAL" \\
  -d '${getDefaultPayload(service)}'`;
}

export default function FirstInvocationPanel({
  services,
  isLoading,
  error,
  selectedServiceId,
  onSelectService,
  credential,
  onCredentialChange,
  onPersistCredential,
  onRunExample,
  isInvoking,
  invokeError,
  result,
}: Readonly<FirstInvocationPanelProps>) {
  const [activeTab, setActiveTab] = useState<SnippetTab>("typescript");
  const [payloadDraft, setPayloadDraft] = useState("");
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const selectedService = services.find((service) => service.serviceId === selectedServiceId) ?? services[0];

  useEffect(() => {
    setPayloadDraft(getDefaultPayload(selectedService));
  }, [selectedServiceId, selectedService]);

  const snippets: Record<SnippetTab, string> = {
    typescript: buildTypescriptSnippet(selectedService),
    python: buildPythonSnippet(selectedService),
    curl: buildCurlSnippet(selectedService),
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(id);
    setTimeout(() => setCopiedItem(null), 1500);
  };

  return (
    <section id="first-invocation-panel" className="grid gap-6 xl:grid-cols-[1.25fr,0.95fr]" aria-label="First invocation panel">
      <article className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-300/80">First Invocation</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Discovery, quote, and invoke in one place</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              This panel turns the agent credential into a real call path. Pick a service, inspect the SDK snippets, then run the same payload through the paid sandbox below.
            </p>
          </div>

          <div className="flex rounded-full border border-white/10 bg-black/20 p-1">
            {(["typescript", "python", "curl"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition ${activeTab === tab ? "bg-white text-slate-950" : "text-gray-400 hover:text-white"}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr,1.1fr]">
          <section className="space-y-4 rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div>
              <label htmlFor="sandbox-service" className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">
                Demo Service
              </label>
              <select
                id="sandbox-service"
                value={selectedService?.serviceId ?? ""}
                onChange={(event) => onSelectService(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500/40"
                disabled={isLoading || services.length === 0}
              >
                {services.length === 0 && <option value="">No public services available</option>}
                {services.map((service) => (
                  <option key={service.serviceId} value={service.serviceId}>
                    {service.name} ({formatPricing(service.pricing)})
                  </option>
                ))}
              </select>
            </div>

            <dl className="space-y-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Discovery Result</dt>
                <dd className="mt-2 text-sm font-semibold text-white">{selectedService?.name || "No service selected"}</dd>
                <dd className="mt-1 text-xs leading-5 text-gray-400">{selectedService?.summary || "Discover a public service before quoting and invoking."}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Quote Preview</dt>
                <dd className="mt-2 text-sm font-semibold text-emerald-300">{selectedService ? formatPricing(selectedService.pricing) : "Unknown"}</dd>
                <dd className="mt-1 text-xs leading-5 text-gray-400">Current catalog pricing. The SDK quote step finalizes the payment terms before invoke.</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Gateway Endpoint</dt>
                <dd className="mt-2 break-all font-mono text-xs text-blue-300">{selectedService?.endpoint || "No endpoint selected"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-3">
              <Link href="/dashboard/discovery" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white transition hover:border-blue-400/40 hover:bg-white/5">
                Browse Marketplace
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <Link href="/dashboard/developer" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white transition hover:border-blue-400/40 hover:bg-white/5">
                SDK Guide
                <Terminal className="h-3.5 w-3.5" />
              </Link>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[24px] border border-white/8 bg-[#09101d] p-5">
            <button
              type="button"
              onClick={() => handleCopy(snippets[activeTab], activeTab)}
              className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
            >
              {copiedItem === activeTab ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedItem === activeTab ? "Copied" : "Copy"}
            </button>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">{activeTab} flow</p>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-white/8 bg-black/30 p-5 font-mono text-xs leading-6 text-blue-200">
              <code>{snippets[activeTab]}</code>
            </pre>
          </section>
        </div>
      </article>

      <aside className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,11,20,0.92),rgba(15,23,42,0.92))] p-6">
        <header className="flex items-start gap-3">
          <span className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3" aria-hidden="true">
            <Rocket className="h-5 w-5 text-amber-300" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-300/80">Sandbox Invocation</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Run the paid example with a real credential</h3>
            <p className="mt-2 text-sm leading-6 text-gray-400">
              Paste the one-time credential, persist it for this service, then execute the payload. The result shows the on-chain payment hash and the gateway response together.
            </p>
          </div>
        </header>

        <div className="mt-6 space-y-4">
          <label htmlFor="sandbox-credential" className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Agent Credential</span>
            <textarea
              id="sandbox-credential"
              value={credential}
              onChange={(event) => onCredentialChange(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-xs text-emerald-300 outline-none transition focus:border-emerald-400/40"
              placeholder="Paste the one-time credential token here"
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
              Save For Service
            </button>
            <button
              type="button"
              onClick={() => handleCopy(payloadDraft, "payload")}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.22em] text-white transition hover:bg-white/10"
            >
              {copiedItem === "payload" ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
              Copy Payload
            </button>
          </div>

          <label htmlFor="sandbox-payload" className="block space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Invoke Payload</span>
            <textarea
              id="sandbox-payload"
              value={payloadDraft}
              onChange={(event) => setPayloadDraft(event.target.value)}
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
            {isInvoking ? "Processing Payment And Invoke" : "Run Paid Example"}
          </button>
        </div>

        <section className="mt-6 rounded-[24px] border border-white/10 bg-black/20 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Result</p>
          {result ? (
            <div className="mt-4 space-y-4">
              <dl className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Service</dt>
                  <dd className="mt-2 text-sm font-semibold text-white">{result.serviceName}</dd>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Charged</dt>
                  <dd className="mt-2 text-sm font-semibold text-emerald-300">{result.chargedUsdc} USDC</dd>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Attempts</dt>
                  <dd className="mt-2 text-sm font-semibold text-white">{result.attempts}</dd>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Latency</dt>
                  <dd className="mt-2 text-sm font-semibold text-white">{result.durationMs} ms</dd>
                </div>
              </dl>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Transaction Hash</p>
                <p className="mt-2 break-all font-mono text-xs text-blue-300">{result.txHash}</p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Request Id</p>
                <p className="mt-2 break-all font-mono text-xs text-white">{result.requestId || "Unavailable in gateway response"}</p>
              </div>

              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-white/8 bg-[#050b16] p-4 font-mono text-xs leading-6 text-emerald-200">
                <code>{JSON.stringify(result.response, null, 2)}</code>
              </pre>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-gray-400">
              No invocation has been executed from this panel yet. A successful run will display the payment hash, retry count, charged USDC, request id, and gateway payload here.
            </p>
          )}
        </section>
      </aside>
    </section>
  );
}