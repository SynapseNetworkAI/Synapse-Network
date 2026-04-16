"use client";

import Link from "next/link";
import { ArrowRight, Clock3, Sparkles } from "lucide-react";
import { formatPricing } from "@/utils/pricing";
import type { ServiceRegistryRecord } from "@/utils/serviceApi";

type ServiceRegistryFeedLabels = {
  loading: string;
  empty: string;
  pricing: string;
  updated: string;
  noSummary: string;
  unnamedService: string;
  statusReady: string;
  statusUnavailable: string;
  usagePerCall: string;
  usagePerSuccess: string;
  serviceAction: string;
  unavailableAction: string;
  updatedUnavailable: string;
};

type ServiceRegistryFeedProps = {
  services: ServiceRegistryRecord[];
  isLoading: boolean;
  labels: ServiceRegistryFeedLabels;
  highlightedServiceId?: string | null;
  highlightToken?: number;
  highlightLabel?: string;
};

function formatUpdated(value: ServiceRegistryRecord["updatedAt"], fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    }
    return value;
  }
  return fallback;
}

function isServiceReady(service: ServiceRegistryRecord): boolean {
  return service.isActive !== false && service.runtimeAvailable !== false;
}

function resolveStatusLabel(service: ServiceRegistryRecord, labels: ServiceRegistryFeedLabels): string {
  return isServiceReady(service) ? labels.statusReady : labels.statusUnavailable;
}

function resolveUsageLabel(service: ServiceRegistryRecord, labels: ServiceRegistryFeedLabels): string {
  return service.metering?.billingUnit === "per_success_call" ? labels.usagePerSuccess : labels.usagePerCall;
}

export default function ServiceRegistryFeed({
  services,
  isLoading,
  labels,
  highlightedServiceId,
  highlightToken,
  highlightLabel,
}: Readonly<ServiceRegistryFeedProps>) {
  if (isLoading) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-sm text-[#a6a6ad]">{labels.loading}</p>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="mx-auto max-w-md text-sm leading-7 text-[#a6a6ad]">{labels.empty}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-white/[0.07]">
      {services.map((service, index) => {
        const summary = service.summary?.trim() || labels.noSummary;
        const updatedAt = formatUpdated(service.updatedAt, labels.updatedUnavailable);
        const isHighlighted = highlightedServiceId === service.serviceId;
        const isReady = isServiceReady(service);

        return (
          <article
            key={service.id || service.serviceId}
            className={[
              "registry-feed-row group grid gap-5 px-4 py-5 transition hover:bg-white/[0.045] sm:px-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(14rem,0.42fr)_minmax(11rem,0.32fr)_auto] lg:items-center",
              isHighlighted ? "registry-feed-row-highlight" : "",
            ].join(" ")}
            style={{ animationDelay: `${Math.min(index * 0.55, 4.4)}s` }}
            data-highlight-token={isHighlighted && typeof highlightToken === "number" ? highlightToken : undefined}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    "registry-feed-dot inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold",
                    isReady
                      ? "border-[#7ff7be]/20 bg-[#7ff7be]/[0.08] text-[#bdf9dc]"
                      : "border-white/10 bg-white/[0.04] text-white/58",
                  ].join(" ")}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {resolveStatusLabel(service, labels)}
                </span>
                {isHighlighted && highlightLabel ? (
                  <span className="inline-flex rounded-full border border-white/12 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold text-white/68">
                    {highlightLabel}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 min-w-0">
                <h3 className="truncate text-xl font-[720] tracking-[-0.04em] text-white">
                  {service.serviceName || service.name || labels.unnamedService}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#a6a6ad]">
                  {summary}
                </p>
              </div>

              {service.tags && service.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {service.tags.slice(0, 5).map((tag) => (
                    <span
                      key={`${service.serviceId}-${tag}`}
                      className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] font-medium text-white/62"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/36">{labels.pricing}</p>
              <p className="mt-2 text-lg font-[720] tracking-[-0.03em] text-[#98f0c4]">{formatPricing(service.pricing)}</p>
              <p className="mt-1 text-xs text-white/46">{resolveUsageLabel(service, labels)}</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/36">{labels.updated}</p>
              <p className="mt-2 flex items-center gap-2 text-sm text-[#d6d6dc]">
                <Clock3 className="h-3.5 w-3.5 text-white/38" />
                {updatedAt}
              </p>
            </div>

            <Link
              href="/dashboard/discovery"
              className={[
                "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition sm:w-auto lg:justify-self-end",
                isReady
                  ? "bg-[#7ff7be] text-black hover:bg-[#6ae5ac] group-hover:shadow-[0_0_32px_rgba(127,247,190,0.12)]"
                  : "border border-white/14 text-white/74 hover:border-white/28 hover:bg-white/[0.05] hover:text-white",
              ].join(" ")}
            >
              {isReady ? labels.serviceAction : labels.unavailableAction}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </article>
        );
      })}
    </div>
  );
}
