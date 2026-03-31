"use client";

import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { Server, Shield, Gauge, Link2, Search, X, Activity, Plus } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import {
  deleteServiceRegistry,
  invalidateServiceRegistryListCache,
  listServiceRegistry,
  upsertServiceRegistryListCache,
  updateServiceRegistry,
  type ServiceRegistryPayload,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import { formatPricing } from "@/utils/pricing";
import { useAuth } from "@/components/WalletAuthGuard";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  DEFAULT_SERVICE_EDIT_DRAFT_CONFIG,
  SERVICE_CONSTRAINT_LIMITS,
  buildEditDraftFromService,
  buildOptimisticServiceRecord,
  buildServicePayloadFromEditDraft,
  buildServiceStatusUpdatePayload,
  type ServiceEditDraft,
  validateServiceEditDraft,
} from "@/utils/serviceStatus";

type ServiceStatusFilter = "all" | "online" | "offline";
type TranslateFn = (key: string, vars?: Record<string, string | number>, fallbackText?: string) => string;

function isServiceRuntimeOnline(svc: ServiceRegistryRecord): boolean {
  if (!svc.isActive) {
    return false;
  }
  if (typeof (svc as { runtimeAvailable?: unknown }).runtimeAvailable === "boolean") {
    return Boolean((svc as { runtimeAvailable?: boolean }).runtimeAvailable);
  }
  const health = svc.health;
  if (!health) {
    return true;
  }
  const healthyTargets = Number(health.healthyTargets || 0);
  return healthyTargets > 0 && String(health.overallStatus || "").toLowerCase() !== "unhealthy";
}

function normalizedServiceStatus(svc: ServiceRegistryRecord): "active" | "inactive" | "archived" | "deleted" {
  const raw = String(svc.status || "").toLowerCase();
  if (raw === "inactive" || raw === "archived" || raw === "deleted") {
    return raw;
  }
  return svc.isActive ? "active" : "inactive";
}

function serviceStatusLabel(status: ReturnType<typeof normalizedServiceStatus>, t: TranslateFn): string {
  if (status === "active") return t("providerServicesPage.statusActive");
  if (status === "inactive") return t("providerServicesPage.statusInactive");
  if (status === "deleted") return t("providerServicesPage.statusDeleted");
  return t("providerServicesPage.statusArchived");
}

function localizeValidationMessage(message: string, t: TranslateFn): string {
  const normalized = message.trim();
  if (!normalized) {
    return normalized;
  }

  const withField = (key: string, field: string) => t(key, { field });

  if (normalized === "Draft not ready") {
    return t("providerServicesPage.validationFixBeforeSave");
  }
  if (normalized === "Service name is required.") {
    return withField("providerServicesPage.validationFieldRequired", t("providerServicesPage.fieldServiceName"));
  }
  if (normalized === "Unit price must be a non-negative number.") {
    return withField("providerServicesPage.validationNonNegativeNumber", t("providerServicesPage.fieldUnitPrice"));
  }
  if (normalized === "Health path is required.") {
    return withField("providerServicesPage.validationFieldRequired", t("providerServicesPage.fieldHealthPath"));
  }
  if (normalized === "Health path must start with /.") {
    return withField("providerServicesPage.validationMustStartWithSlash", t("providerServicesPage.fieldHealthPath"));
  }
  if (normalized === "Invoke URL is required." || normalized === "Invoke URL is required") {
    return withField("providerServicesPage.validationFieldRequired", t("providerServicesPage.fieldInvokeUrl"));
  }
  if (normalized === "Invalid invoke targets JSON.") {
    return withField("providerServicesPage.validationInvalidJson", t("providerServicesPage.fieldInvokeTargets"));
  }
  if (normalized === "Targets must be a JSON array") {
    return withField("providerServicesPage.validationMustBeJsonArray", t("providerServicesPage.fieldInvokeTargets"));
  }
  if (normalized === "At least one invoke target with a valid url is required") {
    return withField("providerServicesPage.validationOneValidTargetRequired", t("providerServicesPage.fieldInvokeTargets"));
  }
  if (normalized === "Request schema must be a valid JSON object.") {
    return withField("providerServicesPage.validationMustBeValidJsonObject", t("providerServicesPage.fieldRequestSchema"));
  }
  if (normalized === "Response schema must be a valid JSON object.") {
    return withField("providerServicesPage.validationMustBeValidJsonObject", t("providerServicesPage.fieldResponseSchema"));
  }

  return normalized;
}

export default function ProviderServicesPage() { // NOSONAR
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated, authorize } = useAuth();
  const { openConnectModal } = useConnectModal();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const [statusInput, setStatusInput] = useState<ServiceStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ServiceStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ServiceRegistryRecord | null>(null);
  const [draft, setDraft] = useState<ServiceEditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusUpdatingServiceId, setStatusUpdatingServiceId] = useState<string | null>(null);
  const [deletingServiceId, setDeletingServiceId] = useState<string | null>(null);
  const pageSize = 8;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!address || !isSessionAuthenticated) {
        setServices([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const rows = await listServiceRegistry(address, address);
        if (!cancelled) {
          setServices(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setServices([]);
          toast.error(err instanceof Error ? err.message : t("providerServicesPage.loadFailed"));
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
  }, [address, isSessionAuthenticated, t]);

  useEffect(() => {
    const editServiceId = searchParams?.get("edit");
    if (!editServiceId || services.length === 0) {
      return;
    }
    const matched = services.find((svc) => svc.serviceId === editServiceId);
    if (matched) {
      setEditing(matched);
      setDraft(buildEditDraftFromService(matched, DEFAULT_SERVICE_EDIT_DRAFT_CONFIG));
    }
  }, [searchParams, services]);

  useEffect(() => {
    if (!editing || typeof document === "undefined") {
      return;
    }

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousOverscrollBehavior = body.style.overscrollBehavior;

    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "contain";

    return () => {
      body.style.overflow = previousOverflow;
      body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [editing]);

  useEffect(() => {
    if (!editing || globalThis.window === undefined) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setEditing(null);
      setDraft(null);
    };

    globalThis.window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editing]);

  const applySearch = () => {
    setQuery(queryInput);
    setStatus(statusInput);
    setPage(1);
  };

  const handleSearch = () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    applySearch();
  };

  const handleOpenNewService = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    if (!isConnected) {
      event.preventDefault();
      openConnectModal?.();
      return;
    }

    if (isSessionAuthenticated) {
      return;
    }

    event.preventDefault();
    const authorized = await authorize();
    if (authorized) {
      router.push("/provider/services/deploy");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((svc) => {
      const byServiceId = (svc.serviceId || "").toLowerCase().includes(q);
      const byName = (svc.name || svc.serviceName || "").toLowerCase().includes(q);
      const matchesText = !q || byServiceId || byName;
      const runtimeOnline = isServiceRuntimeOnline(svc);
      const matchesStatus =
        status === "all"
        || (status === "online" && runtimeOnline)
        || (status === "offline" && !runtimeOnline);
      return matchesText && matchesStatus;
    });
  }, [query, services, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage]);

  const rawEditValidation = useMemo(() => validateServiceEditDraft(draft, SERVICE_CONSTRAINT_LIMITS), [draft]);
  const editValidation = useMemo(() => {
    const localizedErrors = Object.fromEntries(
      Object.entries(rawEditValidation.errors).map(([field, message]) => [field, localizeValidationMessage(message, t)]),
    );

    return {
      ...rawEditValidation,
      errors: localizedErrors,
      firstError: rawEditValidation.firstError ? localizeValidationMessage(rawEditValidation.firstError, t) : null,
    };
  }, [rawEditValidation, t]);

  const closeModal = () => {
    setEditing(null);
    setDraft(null);
  };

  const openEditModal = (svc: ServiceRegistryRecord) => {
    const serviceStatus = normalizedServiceStatus(svc);
    if (serviceStatus !== "inactive") {
      toast.error(
        serviceStatus === "active"
          ? t("providerServicesPage.activeEditBlocked")
          : t("providerServicesPage.inactiveOnlyEditBlocked"),
      );
      return;
    }

    setEditing(svc);
    const nextDraft = buildEditDraftFromService(svc, DEFAULT_SERVICE_EDIT_DRAFT_CONFIG);
    if (!nextDraft.invokeUrl.trim()) {
      nextDraft.invokeUrl =
        svc.endpoint
        || svc.invoke?.url
        || (Array.isArray(svc.invoke?.targets) ? (svc.invoke?.targets[0]?.url || "") : "");
    }
    setDraft(nextDraft);
  };

  const buildServicePayload = (service: ServiceRegistryRecord, nextDraft: ServiceEditDraft): ServiceRegistryPayload =>
    buildServicePayloadFromEditDraft(service, nextDraft, DEFAULT_SERVICE_EDIT_DRAFT_CONFIG);

  const updateServiceStatus = async (service: ServiceRegistryRecord, nextActive: boolean) => {
    if (!address || saving || statusUpdatingServiceId || deletingServiceId) {
      return;
    }

    const actionLabel = nextActive ? t("providerServicesPage.actionActivate") : t("providerServicesPage.actionInactive");
    const confirmed = globalThis.confirm(
      nextActive
        ? t("providerServicesPage.confirmActivate", { serviceId: service.serviceId })
        : t("providerServicesPage.confirmDeactivate", { serviceId: service.serviceId }),
    );
    if (!confirmed) {
      return;
    }

    try {
      const payload = buildServiceStatusUpdatePayload(service, nextActive);
      const optimisticService = buildOptimisticServiceRecord(service, payload);

      const prevServices = services;
      setStatusUpdatingServiceId(service.serviceId);
      setServices((prev) => prev.map((svc) => (svc.serviceId === service.serviceId ? optimisticService : svc)));
      upsertServiceRegistryListCache(optimisticService);

      try {
        await updateServiceRegistry(payload, address);
        toast.success(nextActive ? t("providerServicesPage.serviceActivated") : t("providerServicesPage.serviceSetInactive"));
      } catch (err) {
        setServices(prevServices);
        invalidateServiceRegistryListCache(address);
        toast.error(err instanceof Error ? err.message : t("providerServicesPage.updateStatusFailed", { action: actionLabel }));
      } finally {
        setStatusUpdatingServiceId(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("providerServicesPage.updateStatusFailed", { action: actionLabel }));
    }
  };

  const deleteService = async (service: ServiceRegistryRecord) => {
    if (!address || saving || statusUpdatingServiceId || deletingServiceId || service.isActive) {
      return;
    }

    const confirmed = globalThis.confirm(t("providerServicesPage.confirmDelete", { serviceId: service.serviceId }));
    if (!confirmed) {
      return;
    }

    const prevServices = services;
    setDeletingServiceId(service.serviceId);
    setServices((prev) => prev.filter((svc) => svc.serviceId !== service.serviceId));
    if (editing?.serviceId === service.serviceId) {
      closeModal();
    }

    try {
      await deleteServiceRegistry(service.serviceId, address);
      toast.success(t("providerServicesPage.serviceDeleted"));
    } catch (err) {
      setServices(prevServices);
      invalidateServiceRegistryListCache(address);
      toast.error(err instanceof Error ? err.message : t("providerServicesPage.deleteFailed"));
    } finally {
      setDeletingServiceId(null);
    }
  };

  const persistEdit = async () => {
    if (!address || !editing || !draft) {
      return;
    }

    if (normalizedServiceStatus(editing) !== "inactive") {
      toast.error(t("providerServicesPage.activeEditBlocked"));
      return;
    }

    if (!editValidation.isValid) {
      toast.error(editValidation.firstError || t("providerServicesPage.validationFixBeforeSave"));
      return;
    }

    try {
      const payload = buildServicePayload(editing, draft);
      const optimisticService = buildOptimisticServiceRecord(editing, payload);

      const prevServices = services;
      setServices((prev) => prev.map((svc) => (svc.serviceId === editing.serviceId ? optimisticService : svc)));
      upsertServiceRegistryListCache(optimisticService);

      setSaving(true);
      try {
        await updateServiceRegistry(payload, address);
        toast.success(t("providerServicesPage.serviceUpdated"));
        closeModal();
      } catch (err) {
        setServices(prevServices);
        invalidateServiceRegistryListCache(address);
        toast.error(err instanceof Error ? err.message : t("providerServicesPage.updateFailed"));
      } finally {
        setSaving(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("providerServicesPage.invalidJsonFields"));
    }
  };

  const editModal = editing && draft && typeof document !== "undefined"
    ? createPortal(
      <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]">
        <div className="flex min-h-full items-start justify-center py-6">
          <div className="w-full max-w-6xl rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between border-b border-[#1d1d1d] pb-4">
              <div>
                <h2 className="text-xl font-bold text-white">{t("providerServicesPage.modalTitle")}</h2>
                <p className="mt-1 font-mono text-xs text-[#86868b]">{editing.serviceId}</p>
                <p className="mt-2 text-xs text-[#86868b]">{t("providerServicesPage.modalDescription")}</p>
              </div>
              <button
                onClick={closeModal}
                className="rounded-lg border border-[#333333] p-2 text-[#86868b] hover:border-white hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!editValidation.isValid && (
              <div className="mb-4 rounded-lg border border-[#7f1d1d] bg-[#2a0f12] px-4 py-3 text-sm text-[#fca5a5]">
                {t("providerServicesPage.validationBanner")}
              </div>
            )}

            <div className="space-y-6">
              <section className="rounded-xl border border-[#1d1d1d] bg-[#050505] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9ba0a5]">{t("providerServicesPage.sectionBasicProfile")}</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldServiceName")}</span>
                    <input
                      value={draft.serviceName}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, serviceName: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.serviceName ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.serviceName && <p className="text-xs text-[#f87171]">{editValidation.errors.serviceName}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldUnitPrice")}</span>
                    <input
                      value={draft.pricingAmount}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, pricingAmount: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.pricingAmount ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.pricingAmount && <p className="text-xs text-[#f87171]">{editValidation.errors.pricingAmount}</p>}
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldSummary")}</span>
                    <textarea
                      rows={2}
                      value={draft.summary}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, summary: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldTags")}</span>
                    <input
                      value={draft.tagsText}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, tagsText: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-sm text-[#c6c6c9]">
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, isActive: event.target.checked } : prev))}
                      className="h-4 w-4 rounded border-[#333333] bg-[#111111] text-[#22c55e]"
                    />
                    <span>{t("providerServicesPage.fieldServiceActive")}</span>
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-[#1d1d1d] bg-[#050505] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9ba0a5]">{t("providerServicesPage.sectionHealthConstraints")}</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldHealthPath")}</span>
                    <input
                      value={draft.healthPath}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, healthPath: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.healthPath ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.healthPath && <p className="text-xs text-[#f87171]">{editValidation.errors.healthPath}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldHealthMethod")}</span>
                    <select
                      value={draft.healthMethod}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, healthMethod: event.target.value as "GET" | "HEAD" | "POST" } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    >
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                      <option value="POST">POST</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldHealthIntervalSec")}</span>
                    <input
                      value={draft.healthIntervalSec}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, healthIntervalSec: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldHealthTimeoutMs")}</span>
                    <input
                      value={draft.healthTimeoutMs}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, healthTimeoutMs: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldHealthSuccessCodes")}</span>
                    <input
                      value={draft.healthSuccessCodesText}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, healthSuccessCodesText: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldHealthyThreshold")}</span>
                    <input
                      value={draft.healthyThreshold}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, healthyThreshold: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldUnhealthyThreshold")}</span>
                    <input
                      value={draft.unhealthyThreshold}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, unhealthyThreshold: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldConstraintTimeoutMs")}</span>
                    <input
                      value={draft.constraintsTimeoutMs}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, constraintsTimeoutMs: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsTimeoutMs ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">{t("providerServicesPage.platformHardLimit", { min: SERVICE_CONSTRAINT_LIMITS.timeoutMs.min, max: SERVICE_CONSTRAINT_LIMITS.timeoutMs.max })}</p>
                    {editValidation.errors.constraintsTimeoutMs && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsTimeoutMs}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldMaxRequestBytes")}</span>
                    <input
                      value={draft.constraintsMaxRequestBytes}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, constraintsMaxRequestBytes: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsMaxRequestBytes ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">{t("providerServicesPage.platformHardLimit", { min: SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min, max: SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max })}</p>
                    {editValidation.errors.constraintsMaxRequestBytes && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsMaxRequestBytes}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldMaxResponseBytes")}</span>
                    <input
                      value={draft.constraintsMaxResponseBytes}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, constraintsMaxResponseBytes: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsMaxResponseBytes ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">{t("providerServicesPage.platformHardLimit", { min: SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min, max: SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max })}</p>
                    {editValidation.errors.constraintsMaxResponseBytes && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsMaxResponseBytes}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldMaxQps")}</span>
                    <input
                      value={draft.constraintsMaxQps}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, constraintsMaxQps: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsMaxQps ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">{t("providerServicesPage.platformHardLimit", { min: SERVICE_CONSTRAINT_LIMITS.maxQps.min, max: SERVICE_CONSTRAINT_LIMITS.maxQps.max })}</p>
                    {editValidation.errors.constraintsMaxQps && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsMaxQps}</p>}
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-[#1d1d1d] bg-[#050505] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9ba0a5]">{t("providerServicesPage.sectionServiceDefinition")}</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldInvokeMethod")}</span>
                    <input
                      value={draft.invokeMethod}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, invokeMethod: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldInvokeUrl")}</span>
                    <input
                      value={
                        draft.invokeUrl
                        || editing.endpoint
                        || editing.invoke?.url
                        || (Array.isArray(editing.invoke?.targets) ? (editing.invoke?.targets[0]?.url || "") : "")
                      }
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, invokeUrl: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.invokeUrl ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.invokeUrl && <p className="text-xs text-[#f87171]">{editValidation.errors.invokeUrl}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldInvokeTimeoutMs")}</span>
                    <input
                      value={draft.invokeTimeoutMs}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, invokeTimeoutMs: event.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-3">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldInvokeTargets")}</span>
                    <textarea
                      rows={6}
                      value={draft.invokeTargetsJson}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, invokeTargetsJson: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.invokeTargetsJson ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.invokeTargetsJson && <p className="text-xs text-[#f87171]">{editValidation.errors.invokeTargetsJson}</p>}
                  </label>

                  <label className="space-y-2 text-sm md:col-span-3">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldRequestSchema")}</span>
                    <textarea
                      rows={6}
                      value={draft.requestSchemaJson}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, requestSchemaJson: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.requestSchemaJson ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.requestSchemaJson && <p className="text-xs text-[#f87171]">{editValidation.errors.requestSchemaJson}</p>}
                  </label>

                  <label className="space-y-2 text-sm md:col-span-3">
                    <span className="text-[#c6c6c9]">{t("providerServicesPage.fieldResponseSchema")}</span>
                    <textarea
                      rows={6}
                      value={draft.responseSchemaJson}
                      onChange={(event) => setDraft((prev) => (prev ? { ...prev, responseSchemaJson: event.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.responseSchemaJson ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.responseSchemaJson && <p className="text-xs text-[#f87171]">{editValidation.errors.responseSchemaJson}</p>}
                  </label>
                </div>
              </section>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={closeModal}
                className="rounded-lg border border-[#333333] px-4 py-2 text-sm text-[#c6c6c9] hover:border-white hover:text-white"
              >
                {t("providerServicesPage.cancel")}
              </button>
              <button
                onClick={() => void persistEdit()}
                disabled={saving || !editValidation.isValid}
                className="rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/15 px-4 py-2 text-sm font-semibold text-[#22c55e] hover:bg-[#22c55e] hover:text-black disabled:opacity-50"
              >
                {saving ? t("providerServicesPage.saving") : t("providerServicesPage.saveChanges")}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className="mx-auto min-h-screen max-w-7xl space-y-6 bg-[#000000] p-6 text-white md:p-10">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="flex items-center gap-3 text-3xl font-[800] tracking-tight text-white md:text-4xl">
          <Server className="h-8 w-8 text-[#22c55e]" />
          {t("providerServicesPage.title")}
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          {t("providerServicesPage.description")}
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-[#222222] bg-[#0a0a0a] p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full items-center gap-2 lg:w-auto lg:flex-1">
          <label className="flex w-full items-center gap-2 rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 lg:w-[360px]">
            <Search className="h-4 w-4 text-[#86868b]" />
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSearch();
                }
              }}
              placeholder={t("providerServicesPage.searchPlaceholder")}
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#86868b]"
            />
          </label>
          <select
            value={statusInput}
            onChange={(event) => setStatusInput(event.target.value as ServiceStatusFilter)}
            className="min-w-[130px] rounded-lg border border-[#222222] bg-[#050505] px-3 py-2 text-left text-sm text-white outline-none"
          >
            <option value="all">{t("providerServicesPage.filterAllStatus")}</option>
            <option value="online">{t("providerServicesPage.filterOnline")}</option>
            <option value="offline">{t("providerServicesPage.filterOffline")}</option>
          </select>
        </div>
        <div className="flex items-center gap-2 lg:justify-end">
          <button
            onClick={handleSearch}
            className="rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 px-4 py-2 text-sm font-semibold text-[#22c55e] transition-colors hover:bg-[#22c55e] hover:text-black"
          >
            {t("providerServicesPage.searchButton")}
          </button>
          <Link
            href="/provider/services/deploy"
            onClick={(event) => {
              void handleOpenNewService(event);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-[#3a3a3a] bg-[#050505] px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-[#22c55e]/50 hover:text-[#22c55e]"
          >
            <Plus className="h-4 w-4" />
            {t("providerServicesPage.newService")}
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full border-collapse whitespace-nowrap text-left">
          <thead>
            <tr className="border-b border-[#222222] bg-[#050505] text-[10px] font-semibold uppercase tracking-[0.2em] text-[#86868b]">
              <th className="px-6 py-5">{t("providerServicesPage.tableService")}</th>
              <th className="px-6 py-5">{t("providerServicesPage.tableServiceId")}</th>
              <th className="px-6 py-5">{t("providerServicesPage.tablePricing")}</th>
              <th className="px-6 py-5 text-center">{t("providerServicesPage.tableStatus")}</th>
              <th className="px-6 py-5 text-center">{t("providerServicesPage.tableCallable")}</th>
              <th className="px-6 py-5 text-right">{t("providerServicesPage.tableAction")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-14 text-center text-sm text-[#86868b]">
                  {loading ? t("providerServicesPage.loading") : t("providerServicesPage.empty")}
                </td>
              </tr>
            )}
            {pageRows.map((svc) => {
              const isStatusUpdating = statusUpdatingServiceId === svc.serviceId;
              const isDeleting = deletingServiceId === svc.serviceId;
              const serviceStatus = normalizedServiceStatus(svc);
              const canEditService = serviceStatus === "inactive";

              let statusActionLabel = t("providerServicesPage.actionActivate");
              if (isStatusUpdating) {
                statusActionLabel = t("providerServicesPage.actionUpdating");
              } else if (svc.isActive) {
                statusActionLabel = t("providerServicesPage.actionInactive");
              }

              const statusActionClassName = svc.isActive
                ? "border-[#f59e0b]/40 text-[#f59e0b] hover:bg-[#f59e0b] hover:text-black"
                : "border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e] hover:text-black";
              const serviceStatusText = serviceStatusLabel(serviceStatus, t);
              let statusToneClassName = "border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444]";
              if (serviceStatus === "active") {
                statusToneClassName = "border-[#22c55e]/30 bg-[#22c55e]/10 text-[#22c55e]";
              } else if (serviceStatus === "inactive") {
                statusToneClassName = "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[#f59e0b]";
              }

              return (
                <tr key={svc.id} className="transition-colors hover:bg-[#111111]">
                  <td className="px-6 py-5">
                    <div className="font-semibold text-white">{svc.name || svc.serviceName || t("providerServicesPage.unnamedService")}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-[#86868b]">
                      <Link2 className="h-3.5 w-3.5" />
                      {svc.endpoint || "-"}
                    </div>
                  </td>
                  <td className="px-6 py-5 font-mono text-sm text-[#e5e5ea]">{svc.serviceId}</td>
                  <td className="px-6 py-5 font-mono text-sm text-[#e5e5ea]">{formatPricing(svc.pricing)} {t("providerServicesPage.perCall")}</td>
                  <td className="px-6 py-5 text-center">
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${statusToneClassName}`}>
                      {serviceStatusText}
                    </span>
                  </td>
                  <td className="px-6 py-5 text-center">
                    {isServiceRuntimeOnline(svc) ? (
                      <span className="inline-flex items-center rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#22c55e]">
                        <Gauge className="mr-1 h-3 w-3" />
                        {t("providerServicesPage.callable")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-[#333333] bg-[#111111] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#86868b]">
                        {t("providerServicesPage.unavailable")}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => openEditModal(svc)}
                        disabled={saving || isStatusUpdating || isDeleting}
                        title={canEditService ? t("providerServicesPage.editInactiveService") : t("providerServicesPage.setInactiveBeforeEditing")}
                        className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${canEditService
                          ? "border-[#333333] text-white hover:border-[#ffffff] hover:bg-white hover:text-black"
                          : "border-[#f59e0b]/35 text-[#f5d08a] hover:border-[#f59e0b] hover:text-[#f59e0b]"
                        }`}
                      >
                        {t("providerServicesPage.edit")}
                      </button>
                      <button
                        onClick={() => void updateServiceStatus(svc, !svc.isActive)}
                        disabled={saving || isStatusUpdating || isDeleting}
                        className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${statusActionClassName}`}
                      >
                        {statusActionLabel}
                      </button>
                      <button
                        onClick={() => void deleteService(svc)}
                        disabled={saving || isStatusUpdating || isDeleting || svc.isActive}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#ef4444]/40 px-3 py-1.5 text-xs font-bold text-[#fca5a5] transition-all hover:bg-[#ef4444] hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isDeleting ? t("providerServicesPage.deleting") : t("providerServicesPage.delete")}
                      </button>
                      <Link
                        href={`/provider/health?serviceId=${encodeURIComponent(svc.serviceId)}`}
                        className={`inline-flex items-center gap-1 rounded-lg border border-[#22c55e]/40 px-3 py-1.5 text-xs font-bold text-[#22c55e] transition-all hover:bg-[#22c55e] hover:text-black ${isDeleting ? "pointer-events-none opacity-50" : ""}`}
                      >
                        <Activity className="h-3.5 w-3.5" />
                        {t("providerServicesPage.health")}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 text-xs text-[#86868b] md:flex-row md:items-center md:justify-between">
        <div>
          {t("providerServicesPage.paginationShowing", {
            start: (safePage - 1) * pageSize + (filtered.length ? 1 : 0),
            end: Math.min(safePage * pageSize, filtered.length),
            total: filtered.length,
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={safePage <= 1}
            className="rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-1.5 disabled:opacity-40"
          >
            {t("providerServicesPage.paginationPrev")}
          </button>
          <span className="rounded-lg border border-[#222222] bg-[#050505] px-3 py-1.5 text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((currentPage) => Math.min(pageCount, currentPage + 1))}
            disabled={safePage >= pageCount}
            className="rounded-lg border border-[#222222] bg-[#0a0a0a] px-3 py-1.5 disabled:opacity-40"
          >
            {t("providerServicesPage.paginationNext")}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b]">
        <Shield className="h-4 w-4 text-[#22c55e]" />
        {t("providerServicesPage.footerNote")}
      </div>

      {editModal}
    </div>
  );
}
