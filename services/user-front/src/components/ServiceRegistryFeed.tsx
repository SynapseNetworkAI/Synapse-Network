"use client";

import { Copy, Link2 } from "lucide-react";
import { formatPricing } from "@/utils/pricing";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";

type ServiceRegistryFeedLabels = {
  loading: string;
  empty: string;
  serviceId: string;
  endpoint: string;
  pricing: string;
  role: string;
  runtime: string;
  auth: string;
  updated: string;
  method: string;
  noSummary: string;
  runtimeReady: string;
  runtimePending: string;
  copyServiceId: string;
  copyEndpoint: string;
  updatedUnavailable: string;
};

type ServiceRegistryFeedProps = {
  services: ServiceRegistryRecord[];
  isLoading: boolean;
  labels: ServiceRegistryFeedLabels;
  variant?: "preview" | "full";
  onCopyServiceId?: (serviceId: string) => void;
  onCopyEndpoint?: (endpoint: string) => void;
  highlightedServiceId?: string | null;
  highlightToken?: number;
  highlightLabel?: string;
};

function formatUpdated(value: ServiceRegistryRecord["updatedAt"], fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toLocaleString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleString();
    }
    return value;
  }
  return fallback;
}

function resolveRuntimeLabel(service: ServiceRegistryRecord, labels: ServiceRegistryFeedLabels): string {
  return service.runtimeAvailable === false ? labels.runtimePending : labels.runtimeReady;
}

export default function ServiceRegistryFeed({
  services,
  isLoading,
  labels,
  variant = "preview",
  onCopyServiceId,
  onCopyEndpoint,
  highlightedServiceId,
  highlightToken,
  highlightLabel,
}: Readonly<ServiceRegistryFeedProps>) {
  if (isLoading) {
    return <p className="px-5 py-6 text-sm text-[#7a7a82]">{labels.loading}</p>;
  }

  if (services.length === 0) {
    return <p className="px-5 py-6 text-sm text-[#7a7a82]">{labels.empty}</p>;
  }

  if (variant === "preview") {
    return (
      <div className="divide-y divide-white/8">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_140px_120px] gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34 md:grid">
          <span>{labels.serviceId}</span>
          <span>{labels.endpoint}</span>
          <span>{labels.pricing}</span>
          <span>{labels.role}</span>
        </div>
        {services.map((service, index) => (
          <article
            key={service.id || service.serviceId}
            className="px-5 py-5 transition-colors hover:bg-white/[0.028]"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_140px_120px] md:items-center md:gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-2 text-[11px] font-semibold text-white/52">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[0.96rem] font-semibold text-white/94">
                      {service.serviceId}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#7a7a82]">
                      {service.serviceName || service.name || service.serviceId}
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/28 md:hidden">
                  {labels.endpoint}
                </p>
                <p className="truncate font-mono text-xs text-[#b7b7bd]">
                  {service.endpoint}
                </p>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/28 md:hidden">
                  {labels.pricing}
                </p>
                <span className="inline-flex rounded-full border border-[#7ff7be]/18 bg-[#7ff7be]/[0.09] px-3 py-1 text-[11px] font-semibold text-[#98f0c4]">
                  {formatPricing(service.pricing)}
                </span>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/28 md:hidden">
                  {labels.role}
                </p>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/54">
                  {service.role}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="divide-y divide-white/8">
      {services.map((service, index) => {
        const summary = service.summary?.trim() || labels.noSummary;
        const endpoint = service.endpoint || service.invoke?.url || labels.updatedUnavailable;
        const authType = service.auth?.type || "public";
        const updatedAt = formatUpdated(service.updatedAt, labels.updatedUnavailable);
        const method = service.invoke?.method || "POST";
        const isHighlighted = highlightedServiceId === service.serviceId;

        return (
          <article
            key={service.id || service.serviceId}
            className={[
              "registry-feed-row px-5 py-5 transition-colors hover:bg-white/[0.025] sm:px-6",
              isHighlighted ? "registry-feed-row-highlight" : "",
            ].join(" ")}
            style={{ animationDelay: `${Math.min(index * 0.55, 4.4)}s` }}
            data-highlight-token={isHighlighted && typeof highlightToken === "number" ? highlightToken : undefined}
          >
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="registry-feed-dot inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-2 text-[11px] font-semibold text-white/52">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7ff7be]">
                    {resolveRuntimeLabel(service, labels)}
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/34">
                    {service.role}
                  </p>
                  {isHighlighted && highlightLabel ? (
                    <span className="inline-flex rounded-full border border-[#7ff7be]/20 bg-[#7ff7be]/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#bdf9dc]">
                      {highlightLabel}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-2xl font-[720] tracking-[-0.04em] text-white">
                      {service.serviceName || service.name || service.serviceId}
                    </h3>
                    <p className="mt-2 truncate font-mono text-[12px] text-[#a2a2aa]">
                      {service.serviceId}
                    </p>
                  </div>
                  <span className="inline-flex rounded-full border border-[#7ff7be]/18 bg-[#7ff7be]/[0.09] px-3 py-1 text-[11px] font-semibold text-[#98f0c4]">
                    {formatPricing(service.pricing)}
                  </span>
                </div>

                <p className="mt-4 max-w-3xl text-sm leading-7 text-[#8d8d95]">
                  {summary}
                </p>

                {service.tags && service.tags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {service.tags.map((tag) => (
                      <span
                        key={`${service.serviceId}-${tag}`}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-white/54"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {onCopyServiceId ? (
                  <button
                    type="button"
                    onClick={() => onCopyServiceId(service.serviceId)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {labels.copyServiceId}
                  </button>
                ) : null}
                {onCopyEndpoint && service.endpoint ? (
                  <button
                    type="button"
                    onClick={() => onCopyEndpoint(service.endpoint)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {labels.copyEndpoint}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.15rem] border border-white/8 bg-white/[0.025] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">{labels.endpoint}</p>
                <p className="mt-2 truncate font-mono text-[12px] text-[#c7c7cd]">{endpoint}</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/8 bg-white/[0.025] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">{labels.method}</p>
                <p className="mt-2 font-mono text-[12px] text-[#c7c7cd]">{method}</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/8 bg-white/[0.025] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">{labels.auth}</p>
                <p className="mt-2 font-mono text-[12px] uppercase text-[#c7c7cd]">{authType}</p>
              </div>
              <div className="rounded-[1.15rem] border border-white/8 bg-white/[0.025] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">{labels.updated}</p>
                <p className="mt-2 text-[12px] text-[#c7c7cd]">{updatedAt}</p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}