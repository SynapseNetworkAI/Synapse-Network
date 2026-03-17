"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import {
  Activity,
  ArrowRight,
  Bot,
  Copy,
  Fingerprint,
  Globe,
  Network,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import toast from "react-hot-toast";
import { useBuyerData } from "@/hooks/useBuyerData";
import { useAuth } from "@/components/WalletAuthGuard";
import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { formatPricing } from "@/utils/pricing";

const AUTO_POLL_MS = 10000;
const INTENT_PRESETS = [
  "weather forecasting",
  "translation",
  "image generation",
  "compliance screening",
  "data enrichment",
];

const INTENT_TEXTAREA_ID = "agent-workspace-intent";

function resolveStatusMeta(service: ServiceRegistryRecord) {
  const healthStatus = service.health?.overallStatus || service.status || "unknown";

  if (healthStatus === "healthy" || healthStatus === "active") {
    return {
      label: "Healthy",
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-400/20",
      badge: "bg-emerald-400/10",
    };
  }

  if (healthStatus === "degraded") {
    return {
      label: "Degraded",
      dot: "bg-amber-400",
      text: "text-amber-300",
      border: "border-amber-400/20",
      badge: "bg-amber-400/10",
    };
  }

  if (healthStatus === "unhealthy" || healthStatus === "inactive" || healthStatus === "archived") {
    return {
      label: "Unhealthy",
      dot: "bg-red-400",
      text: "text-red-300",
      border: "border-red-400/20",
      badge: "bg-red-400/10",
    };
  }

  return {
    label: "Unknown",
    dot: "bg-zinc-500",
    text: "text-zinc-300",
    border: "border-white/10",
    badge: "bg-white/[0.04]",
  };
}

function extractSchemaKeys(schema: Record<string, unknown> | undefined) {
  const properties = schema && typeof schema === "object" && "properties" in schema
    ? (schema.properties as Record<string, unknown> | undefined)
    : undefined;

  return properties ? Object.keys(properties).slice(0, 6) : [];
}

function resolveServiceTitle(service: ServiceRegistryRecord) {
  return service.serviceName || service.name || service.serviceId;
}

function resolveHealthSummary(service: ServiceRegistryRecord) {
  return `${service.health?.healthyTargets ?? 0}/${service.health?.totalTargets ?? 0} nodes healthy`;
}

function resolveConstraintLabel(service: ServiceRegistryRecord) {
  const timeout = service.constraints?.timeoutMs || service.invoke?.timeoutMs;
  const qps = service.constraints?.maxQps;
  const bytes = service.constraints?.maxResponseBytes;
  const parts = [];

  if (timeout) {
    parts.push(`${timeout}ms timeout`);
  }
  if (qps) {
    parts.push(`${qps} qps`);
  }
  if (bytes) {
    parts.push(`${bytes}B max response`);
  }

  return parts.length > 0 ? parts.join(" • ") : "Standard runtime constraints";
}

function resolveSelectedServiceId(
  rows: ServiceRegistryRecord[],
  current: string | null,
) {
  if (current && rows.some((service) => service.serviceId === current)) {
    return current;
  }

  return rows[0]?.serviceId ?? null;
}

function CandidateState({
  loading,
  services,
}: Readonly<{
  loading: boolean;
  services: ServiceRegistryRecord[];
}>) {
  if (loading) {
    return (
      <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] px-4 py-12 text-center text-sm text-zinc-400">
        Loading service candidates...
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="rounded-[1.4rem] border border-dashed border-white/10 bg-white/[0.02] px-4 py-12 text-center">
        <Globe className="mx-auto h-8 w-8 text-zinc-700" />
        <p className="mt-4 text-base font-medium text-zinc-300">No candidate services matched this intent yet.</p>
        <p className="mt-2 text-sm leading-6 text-zinc-500">Tighten the task description or come back after providers publish more manifests.</p>
      </div>
    );
  }

  return null;
}

function ManifestPreviewEmptyState() {
  return (
    <div className="mt-6 rounded-[1.4rem] border border-dashed border-white/10 bg-white/[0.02] px-4 py-12 text-center">
      <Network className="mx-auto h-8 w-8 text-zinc-700" />
      <p className="mt-4 text-base font-medium text-zinc-300">Pick a candidate to inspect its manifest.</p>
    </div>
  );
}

export default function AgentWorkspacePage() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { isSessionAuthenticated } = useAuth();
  const { stats, handleRefresh, isRefreshing } = useBuyerData();

  const [intent, setIntent] = useState("");
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const updateServices = (rows: ServiceRegistryRecord[]) => {
      setServices(rows);
      setSelectedServiceId((current) => resolveSelectedServiceId(rows, current));
    };

    const handleFailure = (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load services");
    };

    const fetchServices = async () => {
      setError("");

      const rows = await discoverServices(intent);
      if (!active) {
        return;
      }

      updateServices(rows);
    };

    const loadServices = async () => {
      setLoading(true);
      try {
        await fetchServices();
      } catch (err: unknown) {
        if (active) {
          handleFailure(err);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    const refreshServices = async () => {
      setPolling(true);
      try {
        await fetchServices();
      } catch (err: unknown) {
        if (active) {
          handleFailure(err);
        }
      } finally {
        if (active) {
          setPolling(false);
        }
      }
    };

    void loadServices();
    const timer = globalThis.setInterval(() => {
      void refreshServices();
    }, AUTO_POLL_MS);

    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [intent]);

  const selectedService = services.find((service) => service.serviceId === selectedServiceId) ?? services[0] ?? null;
  const inputKeys = selectedService ? extractSchemaKeys(selectedService.invoke?.request.schema) : [];
  const outputKeys = selectedService ? extractSchemaKeys(selectedService.invoke?.response.schema) : [];

  const handleCopy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  const runRefresh = async () => {
    await handleRefresh();
    setIntent((value) => value);
  };

  const candidateState = <CandidateState loading={loading} services={services} />;
  const hasSelectedService = Boolean(selectedService);

  return (
    <div className="min-h-screen bg-black px-6 py-8 text-white md:px-10 md:py-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.12),transparent_28%),linear-gradient(180deg,rgba(10,10,10,0.98),rgba(7,7,7,1))] p-8 shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
                <Bot className="h-3.5 w-3.5" />
                Agent Workspace
              </div>
              <h1 className="text-[clamp(2.3rem,4.6vw,4.4rem)] font-extrabold leading-[0.95] tracking-[-0.06em] text-white">
                Discover the right service. Inspect the manifest. Prepare the first paid invocation.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-zinc-400">
                This is not a marketplace for human browsing. It is a control surface for owner-funded agents to rank candidates, verify runtime shape, and move toward autonomous invocation.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 xl:min-w-[520px]">
              <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Spendable Balance</p>
                <p className="mt-4 text-3xl font-bold tracking-[-0.05em] text-white">{stats.buyerBalance}</p>
                <p className="mt-1 text-xs text-zinc-500">USDC available for runtime consumption</p>
              </article>
              <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Session State</p>
                <p className="mt-4 text-base font-semibold text-white">{isSessionAuthenticated ? "Ready for owner-scoped reads" : "Session signature required"}</p>
                <p className="mt-2 text-xs text-zinc-500">Owner binding gates credentials, balances, and invocation prep.</p>
              </article>
              <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Service Candidates</p>
                <p className="mt-4 text-3xl font-bold tracking-[-0.05em] text-white">{services.length}</p>
                <p className="mt-1 text-xs text-zinc-500">Ranked by the current intent and live health snapshot</p>
              </article>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.92fr_1.18fr_0.9fr]">
          <aside className="space-y-6 rounded-[1.8rem] border border-white/10 bg-[#090909] p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">Task Intent</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Tell the network what the agent needs.</h2>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                Search by job-to-be-done, not by vendor vanity. The intent drives candidate ranking and manifest relevance.
              </p>
            </div>

            <div className="space-y-3">
              <label htmlFor={INTENT_TEXTAREA_ID} className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Intent query</label>
              <textarea
                id={INTENT_TEXTAREA_ID}
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                rows={4}
                placeholder="Find a low-latency weather forecasting API with clean JSON output and predictable pricing."
                className="w-full rounded-[1.2rem] border border-white/10 bg-black px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-emerald-400/40"
              />
              <div className="flex flex-wrap gap-2">
                {INTENT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setIntent(preset)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-emerald-400/30 hover:text-white"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">Activation rail</p>
              <ol className="mt-4 space-y-3">
                {[
                  "Connect wallet and sign owner session.",
                  "Top up spendable balance if budget is empty.",
                  "Issue or rotate credentials for runtime execution.",
                  "Compare candidate services by schema, health, and price.",
                  "Move into invoke console for the first paid call.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm text-zinc-300">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-[11px] font-semibold text-emerald-300">
                      0{index + 1}
                    </span>
                    <span className="leading-6">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-col gap-3">
              {isConnected ? (
                <button
                  type="button"
                  onClick={() => void runRefresh()}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.06]"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-emerald-300" : ""}`} />
                  Refresh owner state
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openConnectModal?.()}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
                >
                  <Wallet className="h-4 w-4" />
                  Connect wallet
                </button>
              )}
              <Link
                href="/dashboard/console"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                <Fingerprint className="h-4 w-4" />
                Manage credentials
              </Link>
            </div>
          </aside>

          <section className="rounded-[1.8rem] border border-white/10 bg-[#090909] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Candidate ranking</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Service shortlist for the current task.</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                <Activity className="h-3.5 w-3.5" />
                {polling ? "Refreshing health" : `Refresh ${AUTO_POLL_MS / 1000}s`}
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-[1.4rem] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}

            <div className="mt-6 space-y-4">
              {candidateState || (
                services.map((service, index) => {
                  const statusMeta = resolveStatusMeta(service);
                  const isSelected = selectedServiceId === service.serviceId;

                  return (
                    <button
                      key={service.id || service.serviceId}
                      type="button"
                      onClick={() => setSelectedServiceId(service.serviceId)}
                      className={`w-full rounded-[1.5rem] border px-5 py-5 text-left transition ${isSelected ? "border-emerald-400/30 bg-emerald-400/6" : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"}`}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-2 text-[11px] font-semibold text-white/60">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusMeta.border} ${statusMeta.badge} ${statusMeta.text}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                              {statusMeta.label}
                            </span>
                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                              {resolveHealthSummary(service)}
                            </span>
                          </div>
                          <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">
                            {resolveServiceTitle(service)}
                          </h3>
                          <p className="mt-1 font-mono text-[12px] text-zinc-500">{service.serviceId}</p>
                          <p className="mt-4 text-sm leading-7 text-zinc-400">
                            {service.summary?.trim() || "Manifest summary unavailable. Use the preview rail to inspect schemas, auth, and runtime constraints."}
                          </p>
                          {service.tags && service.tags.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {service.tags.slice(0, 5).map((tag) => (
                                <span key={`${service.serviceId}-${tag}`} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
                          <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                            {formatPricing(service.pricing)}
                          </span>
                          <span className="text-xs text-zinc-500">{resolveConstraintLabel(service)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <aside className="rounded-[1.8rem] border border-white/10 bg-[#090909] p-6">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Manifest preview</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Inspect runtime contract before invoking.</h2>
            </div>

            {hasSelectedService ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold tracking-tight text-white">{resolveServiceTitle(selectedService)}</h3>
                      <p className="mt-1 font-mono text-[12px] text-zinc-500">{selectedService.serviceId}</p>
                    </div>
                    <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                      {formatPricing(selectedService.pricing)}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-zinc-400">
                    {selectedService.summary?.trim() || "No summary provided by provider manifest."}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Endpoint</p>
                    <p className="mt-2 break-all font-mono text-[12px] text-zinc-300">{selectedService.endpoint || selectedService.invoke?.url || "Unavailable"}</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Auth</p>
                    <p className="mt-2 text-sm text-zinc-300">{selectedService.auth?.type || "public"}</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Method</p>
                    <p className="mt-2 text-sm text-zinc-300">{selectedService.invoke?.method || "POST"}</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Runtime</p>
                    <p className="mt-2 text-sm text-zinc-300">{resolveConstraintLabel(selectedService)}</p>
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Input schema</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {inputKeys.length > 0 ? inputKeys.map((key) => (
                      <span key={key} className="rounded-full border border-white/10 bg-black px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                        {key}
                      </span>
                    )) : <span className="text-sm text-zinc-500">Provider did not expose schema keys.</span>}
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Output schema</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {outputKeys.length > 0 ? outputKeys.map((key) => (
                      <span key={key} className="rounded-full border border-white/10 bg-black px-2.5 py-1 text-[11px] font-mono text-zinc-300">
                        {key}
                      </span>
                    )) : <span className="text-sm text-zinc-500">Provider did not expose response schema keys.</span>}
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Operator actions</p>
                  <div className="mt-4 flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCopy(selectedService.serviceId, "Service ID")}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/[0.06]"
                    >
                      <Copy className="h-4 w-4" />
                      Copy service id
                    </button>
                    {selectedService.endpoint ? (
                      <button
                        type="button"
                        onClick={() => void handleCopy(selectedService.endpoint, "Endpoint")}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white transition hover:border-white/24 hover:bg-white/[0.06]"
                      >
                        <Globe className="h-4 w-4" />
                        Copy endpoint
                      </button>
                    ) : null}
                    <Link
                      href="/dashboard/console"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
                    >
                      Prepare invoke console
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                <div className="rounded-[1.3rem] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <ShieldCheck className="h-4 w-4" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Safety reminder</p>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">
                    Owner session and credentials control access. The public discovery surface should help the agent choose a service without leaking seller settlement internals.
                  </p>
                </div>
              </div>
            ) : (
              <ManifestPreviewEmptyState />
            )}
          </aside>
        </section>
      </div>
    </div>
  );
}
