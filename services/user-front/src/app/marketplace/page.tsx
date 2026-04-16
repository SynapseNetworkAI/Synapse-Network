"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Search, ShieldCheck, WalletCards, Zap } from "lucide-react";
import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import ServiceRegistryFeed from "@/components/ServiceRegistryFeed";

const MARKETPLACE_PAGE_SIZE = 10;

function parseServiceTimestamp(value?: string | number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function buildServiceFingerprint(service: ServiceRegistryRecord): string {
  const overallStatus = service.health?.overallStatus || service.status || "unknown";
  const healthyTargets = service.health?.healthyTargets ?? -1;
  const totalTargets = service.health?.totalTargets ?? -1;

  return JSON.stringify({
    updatedAt: service.updatedAt ?? null,
    createdAt: service.createdAt ?? null,
    status: service.status ?? null,
    overallStatus,
    healthyTargets,
    totalTargets,
    runtimeAvailable: service.runtimeAvailable ?? null,
    pricing: service.pricing ?? null,
    endpoint: service.endpoint ?? null,
    summary: service.summary ?? null,
    tags: service.tags ?? [],
  });
}

function selectMostRecentService(rows: ServiceRegistryRecord[]): ServiceRegistryRecord | null {
  if (rows.length === 0) {
    return null;
  }

  return rows.reduce<ServiceRegistryRecord>((latest, current) => {
    const latestTimestamp = Math.max(parseServiceTimestamp(latest.updatedAt), parseServiceTimestamp(latest.createdAt));
    const currentTimestamp = Math.max(parseServiceTimestamp(current.updatedAt), parseServiceTimestamp(current.createdAt));
    return currentTimestamp > latestTimestamp ? current : latest;
  }, rows[0]);
}

function isCallableMarketplaceService(service: ServiceRegistryRecord): boolean {
  return service.isActive !== false && service.runtimeAvailable !== false;
}

export default function MarketplacePage() {
  const REGISTRY_POLL_MS = 12000;
  const { t } = useLanguage();
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [highlightedServiceId, setHighlightedServiceId] = useState<string | null>(null);
  const [highlightToken, setHighlightToken] = useState(0);
  const previousServicesRef = useRef<Map<string, string>>(new Map());

  const processIncomingRows = useCallback((rows: ServiceRegistryRecord[], triggerHighlight: boolean) => {
    const nextMap = new Map<string, string>();
    let changedService: ServiceRegistryRecord | null = null;
    let changedTimestamp = 0;

    rows.forEach((service) => {
      const fingerprint = buildServiceFingerprint(service);
      nextMap.set(service.serviceId, fingerprint);

      const previousFingerprint = previousServicesRef.current.get(service.serviceId);
      if (!previousFingerprint || previousFingerprint !== fingerprint) {
        const serviceTimestamp = Math.max(parseServiceTimestamp(service.updatedAt), parseServiceTimestamp(service.createdAt));
        if (!changedService || serviceTimestamp >= changedTimestamp) {
          changedService = service;
          changedTimestamp = serviceTimestamp;
        }
      }
    });

    previousServicesRef.current = nextMap;
    setServices(rows);

    if (!triggerHighlight) {
      return;
    }

    const candidate = changedService ?? selectMostRecentService(rows);
    if (!candidate) {
      return;
    }

    setHighlightedServiceId(candidate.serviceId);
    setHighlightToken((current) => current + 1);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadServices = async (silent = false) => {
      try {
        if (!silent) {
          setIsLoading(true);
        }
        const rows = (await discoverServices()).filter(isCallableMarketplaceService);
        if (!mounted) {
          return;
        }
        processIncomingRows(rows, true);
      } catch {
        if (mounted) {
          setServices([]);
        }
      } finally {
        if (mounted) {
          if (!silent) {
            setIsLoading(false);
          }
        }
      }
    };

    void loadServices();

    const interval = globalThis.setInterval(() => {
      void loadServices(true);
    }, REGISTRY_POLL_MS);

    return () => {
      mounted = false;
      globalThis.clearInterval(interval);
    };
  }, [processIncomingRows]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedTag]);

  const availableTags = Array.from(
    new Set(
      services
        .flatMap((service) => service.tags || [])
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredServices = services.filter((service) => {
    if (selectedTag !== "all" && !(service.tags || []).includes(selectedTag)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      service.serviceId,
      service.serviceName,
      service.name,
      service.summary,
      service.endpoint,
      service.role,
      ...(service.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  const activeCount = filteredServices.length;
  const runtimeReadyCount = services.length;
  const totalPages = Math.max(1, Math.ceil(filteredServices.length / MARKETPLACE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * MARKETPLACE_PAGE_SIZE;
  const pageServices = filteredServices.slice(startIndex, startIndex + MARKETPLACE_PAGE_SIZE);
  const pageStart = filteredServices.length === 0 ? 0 : startIndex + 1;
  const pageEnd = Math.min(startIndex + pageServices.length, filteredServices.length);
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const feedLabels = {
    loading: t("marketplacePage.loading"),
    empty: t("marketplacePage.emptyBody"),
    pricing: t("marketplacePage.pricingLabel"),
    updated: t("marketplacePage.updatedLabel"),
    noSummary: t("marketplacePage.noSummary"),
    unnamedService: t("marketplacePage.unnamedService"),
    statusReady: t("marketplacePage.statusReady"),
    statusUnavailable: t("marketplacePage.statusUnavailable"),
    usagePerCall: t("marketplacePage.usagePerCall"),
    usagePerSuccess: t("marketplacePage.usagePerSuccess"),
    serviceAction: t("marketplacePage.serviceAction"),
    unavailableAction: t("marketplacePage.unavailableAction"),
    updatedUnavailable: t("marketplacePage.updatedUnavailable"),
  };

  const valueProps = [
    {
      icon: Zap,
      title: t("marketplacePage.valueOneTitle"),
      body: t("marketplacePage.valueOneBody"),
    },
    {
      icon: WalletCards,
      title: t("marketplacePage.valueTwoTitle"),
      body: t("marketplacePage.valueTwoBody"),
    },
    {
      icon: ShieldCheck,
      title: t("marketplacePage.valueThreeTitle"),
      body: t("marketplacePage.valueThreeBody"),
    },
  ];

  return (
    <div className="relative overflow-hidden bg-[#050505] text-white selection:bg-white selection:text-black">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(127,247,190,0.1),transparent_20%),radial-gradient(circle_at_80%_18%,rgba(255,255,255,0.06),transparent_22%),linear-gradient(180deg,#040404_0%,#050505_56%,#090909_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:120px_120px] [mask-image:radial-gradient(circle_at_center,black,transparent_84%)]" />

      <main className="relative mx-auto max-w-7xl px-6 pb-24 pt-14 sm:pt-20">
        <section className="grid gap-10 py-8 lg:grid-cols-[minmax(0,1.02fr)_minmax(22rem,0.78fr)] lg:items-center lg:py-14">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#7ff7be]">
              {t("marketplacePage.eyebrow")}
            </p>
            <h1 className="mt-4 text-5xl font-[820] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
              {t("marketplacePage.title")}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[#b6b6bd] sm:text-lg">
              {t("marketplacePage.description")}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="#marketplace-services"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7ff7be] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#6ae5ac]"
              >
                {t("marketplacePage.primaryCta")}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/provider/console"
                className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/35 hover:bg-white/[0.05]"
              >
                {t("marketplacePage.providerCta")}
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/36">{t("marketplacePage.totalServices")}</p>
                <p className="mt-2 text-3xl font-[760] tracking-[-0.05em] text-white">{services.length}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/36">{t("marketplacePage.activeServices")}</p>
                <p className="mt-2 text-3xl font-[760] tracking-[-0.05em] text-white">{activeCount}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/36">{t("marketplacePage.runtimeReadyCount")}</p>
                <p className="mt-2 text-3xl font-[760] tracking-[-0.05em] text-white">{runtimeReadyCount}</p>
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 shadow-[0_36px_120px_rgba(0,0,0,0.24)]">
            <div className="absolute inset-x-6 top-8 h-px bg-gradient-to-r from-transparent via-[#7ff7be]/50 to-transparent" />
            <div className="space-y-5 pt-6">
              {valueProps.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4">
                    <div className="relative">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#7ff7be]/18 bg-[#7ff7be]/[0.08] text-[#9af4c8]">
                        <Icon className="h-5 w-5" />
                      </span>
                      {index < valueProps.length - 1 ? (
                        <span className="absolute left-5 top-12 h-12 w-px bg-white/10" />
                      ) : null}
                    </div>
                    <div className="pb-3">
                      <h2 className="text-lg font-[720] tracking-[-0.03em] text-white">{item.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-[#9f9fa7]">{item.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="marketplace-services" className="mt-10 overflow-hidden rounded-[2.4rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] shadow-[0_36px_120px_rgba(0,0,0,0.24)]">
          <div className="border-b border-white/8 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <h2 className="text-3xl font-[760] tracking-[-0.04em] text-white">
                  {t("marketplacePage.registryTitle")}
                </h2>
                <p className="mt-4 text-sm leading-7 text-[#8d8d95] md:text-base">
                  {t("marketplacePage.registryBody")}
                </p>
              </div>
              <div className="rounded-full border border-[#7ff7be]/20 bg-[#7ff7be]/[0.08] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#bdf9dc]">
                {t("marketplacePage.activeOnly")}
              </div>
            </div>
          </div>

          <div className="border-b border-white/8 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <label className="flex flex-1 items-center gap-3 rounded-[1.1rem] border border-white/10 bg-black/25 px-4 py-3">
                <Search className="h-4 w-4 text-white/35" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("marketplacePage.searchPlaceholder")}
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/28"
                />
              </label>

              <div className="flex flex-wrap gap-2 xl:max-w-[38rem] xl:justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedTag("all")}
                  className={[
                    "rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                    selectedTag === "all"
                      ? "border-white/20 bg-white/[0.12] text-white"
                      : "border-white/10 bg-white/[0.03] text-white/48 hover:border-white/20 hover:text-white",
                  ].join(" ")}
                >
                  {t("marketplacePage.allTags")}
                </button>
                {availableTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className={[
                      "rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition",
                      selectedTag === tag
                        ? "border-white/20 bg-white/[0.12] text-white"
                        : "border-white/10 bg-white/[0.03] text-white/48 hover:border-white/20 hover:text-white",
                    ].join(" ")}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-[linear-gradient(180deg,rgba(5,5,5,0.82),rgba(10,10,10,0.9))]">
            <ServiceRegistryFeed
              services={pageServices}
              isLoading={isLoading}
              labels={feedLabels}
              highlightedServiceId={highlightedServiceId}
              highlightToken={highlightToken}
              highlightLabel={t("marketplacePage.justUpdated")}
            />
            {!isLoading && filteredServices.length > 0 ? (
              <div className="flex flex-col gap-4 border-t border-white/[0.08] px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p className="text-sm text-[#8d8d95]">
                  {t("marketplacePage.showingRange")
                    .replace("{start}", String(pageStart))
                    .replace("{end}", String(pageEnd))
                    .replace("{total}", String(filteredServices.length))}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!canGoPrevious}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    className={[
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
                      canGoPrevious
                        ? "border-white/14 text-white hover:border-white/28 hover:bg-white/[0.05]"
                        : "cursor-not-allowed border-white/8 text-white/28",
                    ].join(" ")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("marketplacePage.previousPage")}
                  </button>
                  <span className="hidden text-xs font-semibold uppercase tracking-[0.16em] text-white/38 sm:inline">
                    {t("marketplacePage.pageIndicator")
                      .replace("{page}", String(currentPage))
                      .replace("{totalPages}", String(totalPages))}
                  </span>
                  <button
                    type="button"
                    disabled={!canGoNext}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    className={[
                      "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
                      canGoNext
                        ? "border-[#7ff7be]/22 bg-[#7ff7be]/[0.08] text-[#bdf9dc] hover:bg-[#7ff7be]/[0.13]"
                        : "cursor-not-allowed border-white/8 text-white/28",
                    ].join(" ")}
                  >
                    {t("marketplacePage.nextPage")}
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-16 px-2 py-10 text-center sm:px-10">
          <p className="mx-auto max-w-3xl text-2xl font-[760] leading-tight tracking-[-0.04em] text-white md:text-4xl">
            {t("marketplacePage.closingLine")}
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#9f9fa7] md:text-base">
            {t("marketplacePage.closingBody")}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              href="/dashboard/discovery"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7ff7be] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#6ae5ac]"
            >
              {t("marketplacePage.discoveryCta")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/provider/console"
              className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/35 hover:bg-white/[0.05]"
            >
              {t("marketplacePage.providerCta")}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
