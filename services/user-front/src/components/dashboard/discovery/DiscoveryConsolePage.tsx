"use client";

import { useEffect, useState } from "react";
import {
  Compass,
  Filter,
  Gauge,
  Search,
  Server,
} from "lucide-react";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import XSelect from "@/components/xui/XSelect";
import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { formatPricing } from "@/utils/pricing";

const PAGE_SIZE = 8;

function resolveServiceTitle(service: ServiceRegistryRecord, fallbackTitle: string): string {
  return service.serviceName || service.name || service.serviceId || fallbackTitle;
}

function resolveStatusMeta(service: ServiceRegistryRecord, t: (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string) {
  const rawStatus = String(service.health?.overallStatus || service.status || "unknown").toLowerCase();
  if (rawStatus === "healthy" || rawStatus === "active") {
    return {
      label: t("discoveryPage.healthHealthy"),
      className: "text-emerald-400",
    };
  }
  if (rawStatus === "degraded") {
    return {
      label: t("discoveryPage.healthDegraded"),
      className: "text-amber-400",
    };
  }
  if (rawStatus === "inactive" || rawStatus === "unhealthy" || rawStatus === "archived") {
    return {
      label: t("discoveryPage.healthUnavailable"),
      className: "text-red-400",
    };
  }
  return {
    label: t("discoveryPage.healthUnknown"),
    className: "text-zinc-400",
  };
}

function resolveRouteStatus(service: ServiceRegistryRecord, t: (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string) {
  if (service.runtimeAvailable === false) {
    return {
      label: t("discoveryPage.routeUnavailable"),
      className: "text-red-400",
    };
  }

  return {
    label: t("discoveryPage.routeOnline"),
    className: "text-emerald-400",
  };
}

function resolveVisibleTags(service: ServiceRegistryRecord): string[] {
  return Array.isArray(service.tags) ? service.tags.slice(0, 2) : [];
}

export default function DiscoveryConsolePage() {
  const { t } = useLanguage();
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [sortBy, setSortBy] = useState<"best_match" | "price" | "health" | "invocation_count" | "revenue" | "service_name">("best_match");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;

    const load = async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        setError("");
        const rows = await discoverServices(appliedQuery.trim() || undefined, {
          sortBy,
          sortOrder,
        });
        if (!cancelled) {
          setServices(rows);
          setPage(1);
        }
      } catch (err) {
        if (!cancelled) {
          setServices([]);
          setError(err instanceof Error ? err.message : t("discoveryPage.loadFailed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [appliedQuery, sortBy, sortOrder, t]);

  const totalPages = Math.max(1, Math.ceil(services.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = services.slice(startIndex, startIndex + PAGE_SIZE);

  const applySearch = () => {
    setAppliedQuery(queryInput);
  };

  return (
    <div className="p-8 space-y-8">
      <div>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Compass className="h-6 w-6 text-blue-400" />
            {t("discoveryPage.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t("discoveryPage.description")}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[#0a0a0c] px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-start">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applySearch();
                  }
                }}
                placeholder={t("discoveryPage.searchPlaceholder")}
                className="w-full min-w-0 rounded-lg border border-white/10 bg-white/5 py-2 pl-10 pr-4 text-sm text-white outline-none transition focus:border-blue-500/50 lg:w-96"
              />
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white lg:min-w-[220px]">
              <span className="text-gray-400">{t("discoveryPage.sortByLabel")}</span>
              <Filter className="h-4 w-4 text-gray-500" />
              <XSelect
                value={sortBy}
                onChange={(next) => setSortBy(next)}
                options={[
                  { value: "best_match", label: t("discoveryPage.sortBestMatch") },
                  { value: "revenue", label: t("discoveryPage.sortCallAmount") },
                  { value: "invocation_count", label: t("discoveryPage.sortCallCount") },
                  { value: "price", label: t("discoveryPage.sortPrice") },
                  { value: "health", label: t("discoveryPage.sortHealth") },
                  { value: "service_name", label: t("discoveryPage.sortName") },
                ]}
                triggerClassName="inline-flex min-h-6 w-full items-center justify-between gap-2 bg-transparent text-sm text-white"
              />
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white lg:min-w-[180px]">
              <span className="text-gray-400">{t("discoveryPage.orderLabel")}</span>
              <XSelect
                value={sortOrder}
                onChange={(next) => setSortOrder(next)}
                options={[
                  { value: "desc", label: t("discoveryPage.orderDescending") },
                  { value: "asc", label: t("discoveryPage.orderAscending") },
                ]}
                triggerClassName="inline-flex min-h-6 w-full items-center justify-between gap-2 bg-transparent text-sm text-white"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={applySearch}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200 lg:ml-auto"
          >
            {t("discoveryPage.searchAction")}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0a0a0c]">
        <div className="border-b border-white/5 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-gray-300">{t("discoveryPage.tableTitle")}</div>
              <div className="mt-1 text-xs text-gray-500">{t("discoveryPage.tableDescription")}</div>
            </div>
            <div>{t("discoveryPage.pageIndicator", { current: currentPage, total: totalPages })}</div>
          </div>
        </div>

        {error ? (
          <div className="border-b border-red-400/10 bg-red-400/10 px-6 py-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">{t("discoveryPage.loading")}</div>
        ) : null}

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02]">
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.serviceHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.serviceIdHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.tagsHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.priceHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.callCountHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.callAmountHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.routeStatusHeader")}</th>
              <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-gray-500">{t("discoveryPage.healthHeader")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {!loading && pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center">
                  <Server className="mx-auto h-8 w-8 text-gray-700" />
                  <p className="mt-4 text-sm text-gray-400">{t("discoveryPage.empty")}</p>
                </td>
              </tr>
            ) : null}

            {loading ? null : pageRows.map((service) => {
              const statusMeta = resolveStatusMeta(service, t);
              const routeStatus = resolveRouteStatus(service, t);
              const visibleTags = resolveVisibleTags(service);

              return (
                <tr key={service.serviceId} className="group transition-colors hover:bg-white/[0.01]">
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm font-medium text-white">{resolveServiceTitle(service, t("discoveryPage.unnamedService"))}</div>
                      <div className="mt-1 line-clamp-1 text-xs text-gray-500">{service.summary || t("discoveryPage.noSummary")}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs text-gray-400">{service.serviceId}</span>
                  </td>
                  <td className="px-6 py-4">
                    {visibleTags.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {visibleTags.map((tag) => (
                          <span
                            key={`${service.serviceId}-${tag}`}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-gray-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">--</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm text-emerald-400">{formatPricing(service.pricing)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm text-white">{service.invocationCount ?? 0}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm text-emerald-400">${service.totalRevenueUsdc || "0"}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${routeStatus.className}`}>
                      {routeStatus.label}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Gauge className="h-3.5 w-3.5 text-gray-500" />
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                      <span className="text-xs font-mono text-gray-500">
                        {service.health?.healthyTargets ?? 0}/{service.health?.totalTargets ?? 0}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex flex-col gap-3 border-t border-white/5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 text-xs text-gray-500">
            <p>
              {t("discoveryPage.showingRange", {
                start: services.length === 0 ? 0 : startIndex + 1,
                end: Math.min(startIndex + PAGE_SIZE, services.length),
                total: services.length,
              })}
            </p>
            <p>
              {t("discoveryPage.currentPageStatus", {
                current: currentPage,
                total: totalPages,
                pageSize: PAGE_SIZE,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("discoveryPage.prev")}
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("discoveryPage.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
