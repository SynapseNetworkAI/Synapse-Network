"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import { ArrowRight, ExternalLink, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { discoverServices, type ServiceRegistryRecord } from "@/utils/serviceApi";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import ServiceRegistryFeed from "@/components/ServiceRegistryFeed";

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

export default function MarketplacePage() {
  const REGISTRY_POLL_MS = 12000;
  const router = useRouter();
  const { t } = useLanguage();
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState(true);
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
        const rows = await discoverServices();
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
    if (activeOnly && service.isActive === false) {
      return false;
    }

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

  const activeCount = services.filter((service) => service.isActive !== false).length;
  const runtimeReadyCount = services.filter((service) => service.runtimeAvailable !== false).length;
  const showingAllServices = activeOnly === false;
  const commandParts = ["status=active"];

  if (showingAllServices) {
    commandParts[0] = "status=all";
  }
  if (selectedTag !== "all") {
    commandParts.push(`tag=${encodeURIComponent(selectedTag)}`);
  }
  if (normalizedQuery) {
    commandParts.push(`q=${encodeURIComponent(normalizedQuery)}`);
  }
  const registryFeedHref = `/marketplace/registry.json?${commandParts.join("&")}`;

  const feedLabels = {
    loading: t("marketplacePage.loading"),
    empty: t("marketplacePage.emptyBody"),
    serviceId: t("marketplacePage.serviceIdLabel"),
    endpoint: t("marketplacePage.endpointLabel"),
    pricing: t("marketplacePage.pricingLabel"),
    role: t("marketplacePage.roleLabel"),
    runtime: t("marketplacePage.runtimeLabel"),
    auth: t("marketplacePage.authLabel"),
    updated: t("marketplacePage.updatedLabel"),
    method: t("marketplacePage.methodLabel"),
    noSummary: t("marketplacePage.noSummary"),
    runtimeReady: t("marketplacePage.runtimeReady"),
    runtimePending: t("marketplacePage.runtimePending"),
    copyServiceId: t("marketplacePage.copyServiceId"),
    copyEndpoint: t("marketplacePage.copyEndpoint"),
    updatedUnavailable: t("marketplacePage.updatedUnavailable"),
  };

  const handleCopy = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(t("marketplacePage.copyFailed"));
    }
  };

  return (
    <div className="relative overflow-hidden bg-[#050505] text-white selection:bg-white selection:text-black">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(127,247,190,0.1),transparent_20%),radial-gradient(circle_at_80%_18%,rgba(255,255,255,0.06),transparent_22%),linear-gradient(180deg,#040404_0%,#050505_56%,#090909_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:120px_120px] [mask-image:radial-gradient(circle_at_center,black,transparent_84%)]" />

      <main className="relative mx-auto max-w-7xl px-6 pb-24 pt-16 sm:pt-20">
        <section className="mx-auto max-w-5xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#7ff7be]">
            {t("marketplacePage.eyebrow")}
          </p>
          <h1 className="mt-4 text-5xl font-[820] tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
            {t("marketplacePage.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-[#9a9aa2] sm:text-lg">
            {t("marketplacePage.description")}
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">{t("marketplacePage.totalServices")}</p>
              <p className="mt-3 text-3xl font-[760] tracking-[-0.05em] text-white">{services.length}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">{t("marketplacePage.activeServices")}</p>
              <p className="mt-3 text-3xl font-[760] tracking-[-0.05em] text-white">{activeCount}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-left shadow-[0_24px_80px_rgba(0,0,0,0.16)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/34">{t("marketplacePage.runtimeReadyCount")}</p>
              <p className="mt-3 text-3xl font-[760] tracking-[-0.05em] text-white">{runtimeReadyCount}</p>
            </div>
          </div>
        </section>

        <section className="mt-16 overflow-hidden rounded-[2.4rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] shadow-[0_36px_120px_rgba(0,0,0,0.24)]">
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
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveOnly(true)}
                  className={[
                    "rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition",
                    activeOnly
                      ? "border-[#7ff7be]/20 bg-[#7ff7be]/[0.08] text-[#bdf9dc]"
                      : "border-white/10 bg-white/[0.03] text-white/52 hover:border-white/20 hover:text-white",
                  ].join(" ")}
                >
                  {t("marketplacePage.activeOnly")}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveOnly(false)}
                  className={[
                    "rounded-full border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] transition",
                    showingAllServices
                      ? "border-[#7ff7be]/20 bg-[#7ff7be]/[0.08] text-[#bdf9dc]"
                      : "border-white/10 bg-white/[0.03] text-white/52 hover:border-white/20 hover:text-white",
                  ].join(" ")}
                >
                  {t("marketplacePage.allServicesFilter")}
                </button>
                <Link
                  href={registryFeedHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white"
                >
                  {t("marketplacePage.jsonFeed")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopy(registryFeedHref, t("marketplacePage.feedUrlCopied"));
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:border-white/24 hover:bg-white/[0.08] hover:text-white"
                >
                  {t("marketplacePage.copyFeedUrl")}
                </button>
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
              services={filteredServices}
              isLoading={isLoading}
              labels={feedLabels}
              variant="full"
              highlightedServiceId={highlightedServiceId}
              highlightToken={highlightToken}
              highlightLabel={t("marketplacePage.justUpdated")}
              onCopyServiceId={(serviceId) => {
                void handleCopy(serviceId, t("marketplacePage.copyServiceIdSuccess"));
              }}
              onCopyEndpoint={(endpoint) => {
                void handleCopy(endpoint, t("marketplacePage.copyEndpointSuccess"));
              }}
            />
          </div>
        </section>

        <section className="mt-16 rounded-[2rem] border border-white/10 bg-white/[0.03] px-6 py-10 text-center shadow-[0_30px_120px_rgba(0,0,0,0.26)] sm:px-10">
          <p className="mx-auto max-w-4xl text-xl font-medium leading-9 text-[#d2d2d7] md:text-2xl">
            {t("marketplacePage.closingLine")}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push("/dashboard/discovery")}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#7ff7be] px-6 py-3 text-sm font-semibold text-black transition hover:bg-[#6ae5ac]"
            >
              {t("marketplacePage.discoveryCta")}
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => router.push("/provider/sell")}
              className="inline-flex items-center justify-center rounded-full border border-white/16 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/35 hover:bg-white/[0.05]"
            >
              {t("marketplacePage.providerCta")}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}