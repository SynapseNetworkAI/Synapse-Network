"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Key, ShieldAlert, XCircle } from "lucide-react";
import { useAccount } from "wagmi";

import {
  listApiSecrets,
  listServiceRegistry,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import {
  PROVIDER_LLM_CAPABILITIES,
  type ProviderLlmCapability,
} from "./providerLlmCapabilityCatalog";

const COPY = {
  eyebrow: "LLM capability gate",
  title: "LLM Capabilities",
  description:
    "Track platform-managed OpenAI-compatible model services, provider signing readiness, pricing review status, and production opt-in gates.",
  viewServices: "View Services",
  registeredServices: "Registered LLM Services",
  signingSecrets: "Provider Signing Secrets",
  prodEnabled: "Prod Enabled",
  boundaryNotice:
    "Upstream LLM API keys stay in Secret Manager or runtime environment variables. This console never exposes Owner private keys, upstream API keys, or Gateway settlement controls.",
  model: "Model",
  service: "Synapse Service",
  gates: "Readiness Gates",
  action: "Action",
  registered: "registered",
  notRegistered: "not registered",
  secretReady: "secret ready",
  secretMissing: "secret missing",
  pricingReview: "pricing review",
  requestReview: "Request Review",
};

function hasService(services: ServiceRegistryRecord[], capability: ProviderLlmCapability): boolean {
  return services.some((service) => service.serviceId === capability.serviceId);
}

function GatePill({ ready, label }: { ready: boolean; label: string }) {
  const Icon = ready ? CheckCircle2 : XCircle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${
        ready
          ? "border-[#22c55e]/35 bg-[#22c55e]/10 text-[#86efac]"
          : "border-[#ff9f0a]/35 bg-[#ff9f0a]/10 text-[#ffd7a1]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default function ProviderLlmCapabilitiesPage() {
  const { address } = useAccount();
  const { services, secretCount, loading } = useProviderLlmReadiness(address);
  const registeredCount = useMemo(
    () =>
      PROVIDER_LLM_CAPABILITIES.filter((capability) =>
        hasService(services, capability)
      ).length,
    [services]
  );

  return (
    <div className="min-h-screen bg-[#000000] p-6 text-white md:p-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <LlmHeader />
        <LlmMetrics
          loading={loading}
          registeredCount={registeredCount}
          secretCount={secretCount}
        />
        <BoundaryNotice />
        <CapabilityTable services={services} hasSigningSecret={secretCount > 0} />
      </div>
    </div>
  );
}

function useProviderLlmReadiness(address: string | undefined) {
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [secretCount, setSecretCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) {
      setServices([]);
      setSecretCount(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      listServiceRegistry(address, address, { forceRefresh: true }),
      listApiSecrets(address),
    ])
      .then(([serviceRows, secrets]) => {
        if (cancelled) {
          return;
        }
        setServices(serviceRows);
        setSecretCount(secrets.length);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { services, secretCount, loading };
}

function LlmHeader() {
  return (
    <header className="flex flex-col gap-5 border-b border-[#222222] pb-6 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#22c55e]/25 bg-[#22c55e]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#86efac]">
          <Bot className="h-3.5 w-3.5" />
          {COPY.eyebrow}
        </div>
        <h1 className="text-3xl font-[800] tracking-tight md:text-5xl">
          {COPY.title}
        </h1>
        <p className="mt-4 max-w-3xl text-sm font-medium leading-6 text-[#a1a1aa] md:text-base">
          {COPY.description}
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/provider/secrets"
          className="inline-flex items-center gap-2 rounded-xl border border-[#333333] px-4 py-3 text-sm font-bold text-white transition hover:border-[#ffffff]/60"
        >
          <Key className="h-4 w-4" />
          Manage Provider Credentials
        </Link>
        <Link
          href="/provider/services"
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-black transition hover:bg-gray-200"
        >
          {COPY.viewServices}
        </Link>
      </div>
    </header>
  );
}

function LlmMetrics({
  loading,
  registeredCount,
  secretCount,
}: {
  loading: boolean;
  registeredCount: number;
  secretCount: number;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <Metric label={COPY.registeredServices} value={loading ? "..." : String(registeredCount)} />
      <Metric label={COPY.signingSecrets} value={loading ? "..." : String(secretCount)} />
      <Metric label={COPY.prodEnabled} value="0" />
    </section>
  );
}

function BoundaryNotice() {
  return (
    <section className="rounded-2xl border border-[#ff9f0a]/30 bg-[#ff9f0a]/10 p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#ff9f0a]" />
        <p className="text-sm leading-6 text-[#ffd7a1]">
          {COPY.boundaryNotice}
        </p>
      </div>
    </section>
  );
}

function CapabilityTable({
  services,
  hasSigningSecret,
}: {
  services: ServiceRegistryRecord[];
  hasSigningSecret: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#222222] bg-[#070707]">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] border-b border-[#222222] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[#86868b]">
        <span>{COPY.model}</span>
        <span>{COPY.service}</span>
        <span>{COPY.gates}</span>
        <span>{COPY.action}</span>
      </div>
      {PROVIDER_LLM_CAPABILITIES.map((capability) => (
        <CapabilityRow
          key={capability.serviceId}
          capability={capability}
          registered={hasService(services, capability)}
          hasSigningSecret={hasSigningSecret}
        />
      ))}
    </section>
  );
}

function CapabilityRow({
  capability,
  registered,
  hasSigningSecret,
}: {
  capability: ProviderLlmCapability;
  registered: boolean;
  hasSigningSecret: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 border-b border-[#151515] px-5 py-5 last:border-b-0 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <div>
        <p className="font-bold text-white">{capability.displayName}</p>
        <p className="mt-1 text-xs text-[#86868b]">{capability.providerName} / {capability.modelId}</p>
      </div>
      <div className="text-sm text-[#d4d4d8]">
        <p>{capability.serviceId}</p>
        <p className="mt-1 text-xs text-[#86868b]">{capability.slug}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <GatePill ready={registered} label={registered ? COPY.registered : COPY.notRegistered} />
        <GatePill ready={hasSigningSecret} label={hasSigningSecret ? COPY.secretReady : COPY.secretMissing} />
        <GatePill ready={false} label={COPY.pricingReview} />
      </div>
      <div className="flex items-center">
        <Link
          href={`/forum?category=Provider%20Services&serviceId=${encodeURIComponent(capability.serviceId)}`}
          className="rounded-xl border border-[#333333] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white transition hover:border-[#ffffff]/60"
        >
          {COPY.requestReview}
        </Link>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#86868b]">{label}</p>
      <p className="mt-3 font-mono text-3xl font-[800] tracking-tight text-white">{value}</p>
    </div>
  );
}
