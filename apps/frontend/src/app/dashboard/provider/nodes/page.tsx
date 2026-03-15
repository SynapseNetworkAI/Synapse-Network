"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Server, Shield, Gauge, Link2, Search, X, Activity, Plus } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import toast from "react-hot-toast";
import {
  invalidateServiceRegistryListCache,
  listServiceRegistry,
  upsertServiceRegistryListCache,
  updateServiceRegistry,
  type ServiceRegistryPayload,
  type ServiceRegistryRecord,
} from "@/utils/serviceApi";
import { nowDateTimeString } from "@/utils/time";
import { extractPricingAmount, formatPricing } from "@/utils/pricing";
import { useAuth } from "@/components/WalletAuthGuard";

type NodeStatus = "all" | "online" | "offline";

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

function normalizedServiceStatus(svc: ServiceRegistryRecord): "active" | "inactive" | "archived" {
  const raw = String(svc.status || "").toLowerCase();
  if (raw === "inactive" || raw === "archived") {
    return raw;
  }
  return svc.isActive ? "active" : "inactive";
}

const CONSTRAINT_LIMITS = {
  timeoutMs: { min: 300, max: 15000 },
  maxRequestBytes: { min: 256, max: 262144 },
  maxResponseBytes: { min: 256, max: 1048576 },
  maxQps: { min: 1, max: 200 },
} as const;

const CONSTRAINT_DEFAULTS = {
  timeoutMs: 3000,
  maxRequestBytes: 4096,
  maxResponseBytes: 2048,
  maxQps: 50,
} as const;

type EditDraft = {
  serviceName: string;
  summary: string;
  pricingAmount: string;
  isActive: boolean;
  tagsText: string;
  authType: string;
  authHeaderName: string;
  healthPath: string;
  healthMethod: "GET" | "HEAD" | "POST";
  healthIntervalSec: string;
  healthTimeoutMs: string;
  healthSuccessCodesText: string;
  healthyThreshold: string;
  unhealthyThreshold: string;
  constraintsTimeoutMs: string;
  constraintsMaxResponseBytes: string;
  constraintsMaxRequestBytes: string;
  constraintsMaxQps: string;
  requestIdHeader: string;
  passThroughHeadersText: string;
  injectHeadersJson: string;
  retryMaxAttempts: string;
  retryBackoffMs: string;
  retryOnStatusText: string;
  billingUnit: "per_call" | "per_success_call";
  billOnError: boolean;
  requestIdRequired: boolean;
  responseSizeMetering: boolean;
  invokeMethod: string;
  invokeUrl: string;
  invokeTimeoutMs: string;
  invokeTargetsJson: string;
  requestSchemaJson: string;
  responseSchemaJson: string;
};

function toEditDraft(svc: ServiceRegistryRecord): EditDraft {
  const invokeTargets = svc.invoke?.targets || (svc.endpoint ? [{ url: svc.endpoint, weight: 100 }] : []);
  const invokeUrl = svc.invoke?.url || invokeTargets[0]?.url || svc.endpoint || "";

  return {
    serviceName: svc.serviceName || svc.name || "",
    summary: svc.summary || "",
    pricingAmount: extractPricingAmount(svc.pricing, "0.01"),
    isActive: Boolean(svc.isActive),
    tagsText: (svc.tags || []).join(", "),
    authType: svc.auth?.type || "service_key",
    authHeaderName: svc.auth?.headerName || "X-Credential",
    healthPath: svc.healthCheck?.path || "/health",
    healthMethod: svc.healthCheck?.method || "GET",
    healthIntervalSec: String(svc.healthCheck?.intervalSec ?? 30),
    healthTimeoutMs: String(svc.healthCheck?.timeoutMs ?? 3000),
    healthSuccessCodesText: (svc.healthCheck?.successCodes || [200]).join(","),
    healthyThreshold: String(svc.healthCheck?.healthyThreshold ?? 2),
    unhealthyThreshold: String(svc.healthCheck?.unhealthyThreshold ?? 3),
    constraintsTimeoutMs: String(svc.constraints?.timeoutMs ?? svc.invoke?.timeoutMs ?? CONSTRAINT_DEFAULTS.timeoutMs),
    constraintsMaxResponseBytes: String(svc.constraints?.maxResponseBytes ?? CONSTRAINT_DEFAULTS.maxResponseBytes),
    constraintsMaxRequestBytes: String(svc.constraints?.maxRequestBytes ?? CONSTRAINT_DEFAULTS.maxRequestBytes),
    constraintsMaxQps: String(svc.constraints?.maxQps ?? CONSTRAINT_DEFAULTS.maxQps),
    requestIdHeader: svc.forwarding?.requestIdHeader || "X-Synapse-Request-Id",
    passThroughHeadersText: (svc.forwarding?.passThroughHeaders || []).join(", "),
    injectHeadersJson: JSON.stringify(svc.forwarding?.injectHeaders || {}, null, 2),
    retryMaxAttempts: String(svc.forwarding?.retryPolicy?.maxAttempts ?? 2),
    retryBackoffMs: String(svc.forwarding?.retryPolicy?.backoffMs ?? 200),
    retryOnStatusText: (svc.forwarding?.retryPolicy?.retryOnStatus || [429, 500, 502, 503, 504]).join(","),
    billingUnit: svc.metering?.billingUnit || "per_call",
    billOnError: Boolean(svc.metering?.billOnError),
    requestIdRequired: svc.metering?.requestIdRequired !== false,
    responseSizeMetering: svc.metering?.responseSizeMetering !== false,
    invokeMethod: svc.invoke?.method || "POST",
    invokeUrl,
    invokeTimeoutMs: String(svc.invoke?.timeoutMs ?? 3000),
    invokeTargetsJson: JSON.stringify(invokeTargets, null, 2),
    requestSchemaJson: JSON.stringify(svc.invoke?.request?.schema || { type: "object", properties: {} }, null, 2),
    responseSchemaJson: JSON.stringify(svc.invoke?.response?.schema || { type: "object", properties: {} }, null, 2),
  };
}

function parseCsvText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsvNumbers(value: string): number[] {
  return parseCsvText(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((num) => Number.isFinite(num));
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseObjectJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

function parseTargetsJson(value: string): Array<{ url: string; weight?: number; region?: string }> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TypeError("Targets must be a JSON array");
  }
  const targets = parsed
    .filter((item): item is { url?: unknown; weight?: unknown; region?: unknown } => Boolean(item && typeof item === "object"))
    .map((item) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const weight = Number.isFinite(Number(item.weight)) ? Number(item.weight) : undefined;
      const region = typeof item.region === "string" ? item.region.trim() : undefined;
      return { url, weight, region };
    })
    .filter((item) => Boolean(item.url));

  if (targets.length === 0) {
    throw new Error("At least one invoke target with a valid url is required");
  }

  return targets;
}

function parseStrictInt(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

function isNonNegativeNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
}

type EditValidation = {
  isValid: boolean;
  firstError: string | null;
  errors: Record<string, string>;
};

function validateConstraintField(
  value: string,
  fieldName: string,
  limits: { min: number; max: number },
  errors: Record<string, string>,
  label: string,
): void {
  const parsed = parseStrictInt(value);
  if (parsed === null) {
    errors[fieldName] = `${label} must be an integer.`;
    return;
  }
  if (parsed < limits.min || parsed > limits.max) {
    errors[fieldName] = `${label} must be ${limits.min}-${limits.max}.`;
  }
}

function validateJsonField(
  value: string,
  fieldName: string,
  errors: Record<string, string>,
  message: string,
): void {
  try {
    parseObjectJson(value);
  } catch {
    errors[fieldName] = message;
  }
}

function validateEditDraft(draft: EditDraft | null): EditValidation {
  const errors: Record<string, string> = {};

  if (!draft) {
    return {
      isValid: false,
      firstError: "Draft not ready",
      errors,
    };
  }

  if (!draft.serviceName.trim()) {
    errors.serviceName = "Service name is required.";
  }
  if (!isNonNegativeNumber(draft.pricingAmount)) {
    errors.pricingAmount = "Unit price must be a non-negative number.";
  }
  if (!draft.healthPath.trim()) {
    errors.healthPath = "Health path is required.";
  } else if (!draft.healthPath.trim().startsWith("/")) {
    errors.healthPath = "Health path must start with /.";
  }
  if (!draft.invokeUrl.trim()) {
    errors.invokeUrl = "Invoke URL is required.";
  }

  validateConstraintField(draft.constraintsTimeoutMs, "constraintsTimeoutMs", CONSTRAINT_LIMITS.timeoutMs, errors, "Constraint timeout");
  validateConstraintField(
    draft.constraintsMaxRequestBytes,
    "constraintsMaxRequestBytes",
    CONSTRAINT_LIMITS.maxRequestBytes,
    errors,
    "Max request bytes",
  );
  validateConstraintField(
    draft.constraintsMaxResponseBytes,
    "constraintsMaxResponseBytes",
    CONSTRAINT_LIMITS.maxResponseBytes,
    errors,
    "Max response bytes",
  );
  validateConstraintField(draft.constraintsMaxQps, "constraintsMaxQps", CONSTRAINT_LIMITS.maxQps, errors, "Max QPS");

  try {
    parseTargetsJson(draft.invokeTargetsJson);
  } catch (err) {
    errors.invokeTargetsJson = err instanceof Error ? err.message : "Invalid invoke targets JSON.";
  }

  validateJsonField(draft.requestSchemaJson, "requestSchemaJson", errors, "Request schema must be a valid JSON object.");
  validateJsonField(draft.responseSchemaJson, "responseSchemaJson", errors, "Response schema must be a valid JSON object.");
  validateJsonField(draft.injectHeadersJson, "injectHeadersJson", errors, "Inject headers must be a valid JSON object.");

  return {
    isValid: Object.keys(errors).length === 0,
    firstError: Object.values(errors)[0] || null,
    errors,
  };
}

export default function ProviderNodesPage() {
  const { address, isConnected } = useAccount();
  const { isSessionAuthenticated } = useAuth();
  const { openConnectModal } = useConnectModal();
  const searchParams = useSearchParams();
  const [services, setServices] = useState<ServiceRegistryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState("");
  const [statusInput, setStatusInput] = useState<NodeStatus>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus>("all");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ServiceRegistryRecord | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const PAGE_SIZE = 8;

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
          toast.error(err instanceof Error ? err.message : "Failed to load services");
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
  }, [address, isSessionAuthenticated]);

  useEffect(() => {
    const editServiceId = searchParams.get("edit");
    if (!editServiceId || services.length === 0) {
      return;
    }
    const matched = services.find((svc) => svc.serviceId === editServiceId);
    if (matched) {
      setEditing(matched);
      setDraft(toEditDraft(matched));
    }
  }, [searchParams, services]);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((svc) => {
      const byServiceId = (svc.serviceId || "").toLowerCase().includes(q);
      const byName = (svc.name || svc.serviceName || "").toLowerCase().includes(q);
      const matchesText = !q || byServiceId || byName;
      const runtimeOnline = isServiceRuntimeOnline(svc);
      const matchesStatus =
        status === "all" ||
        (status === "online" && runtimeOnline) ||
        (status === "offline" && !runtimeOnline);
      return matchesText && matchesStatus;
    });
  }, [query, services, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const editValidation = useMemo(() => validateEditDraft(draft), [draft]);

  const closeModal = () => {
    setEditing(null);
    setDraft(null);
  };

  const openEditModal = (svc: ServiceRegistryRecord) => {
    setEditing(svc);
    const nextDraft = toEditDraft(svc);
    if (!nextDraft.invokeUrl.trim()) {
      nextDraft.invokeUrl =
        svc.endpoint ||
        svc.invoke?.url ||
        (Array.isArray(svc.invoke?.targets) ? (svc.invoke?.targets[0]?.url || "") : "");
    }
    setDraft(nextDraft);
  };

  const persistEdit = async () => {
    if (!address || !editing || !draft) {
      return;
    }

    if (!editValidation.isValid) {
      toast.error(editValidation.firstError || "Please fix validation errors before saving.");
      return;
    }

    const normalizedPath = draft.healthPath.trim().startsWith("/")
      ? draft.healthPath.trim()
      : `/${draft.healthPath.trim() || "health"}`;

    let invokeTargets: Array<{ url: string; weight?: number; region?: string }> = [];
    let requestSchema: Record<string, unknown> = {};
    let responseSchema: Record<string, unknown> = {};
    let injectHeaders: Record<string, string> = {};

    try {
      invokeTargets = parseTargetsJson(draft.invokeTargetsJson);
      requestSchema = parseObjectJson(draft.requestSchemaJson);
      responseSchema = parseObjectJson(draft.responseSchemaJson);
      const injectHeadersRaw = parseObjectJson(draft.injectHeadersJson);
      injectHeaders = Object.entries(injectHeadersRaw).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === "string") {
          acc[key] = value;
        }
        return acc;
      }, {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON fields in edit form");
      return;
    }

    const tags = Array.from(new Set(parseCsvText(draft.tagsText)));
    const passThroughHeaders = parseCsvText(draft.passThroughHeadersText);
    const successCodes = parseCsvNumbers(draft.healthSuccessCodesText);
    const retryOnStatus = parseCsvNumbers(draft.retryOnStatusText);

    const invokeUrl = draft.invokeUrl.trim() || invokeTargets[0]?.url || "";
    if (!invokeUrl) {
      toast.error("Invoke URL is required");
      return;
    }

    const payload: ServiceRegistryPayload = {
      id: editing.id,
      serviceId: editing.serviceId,
      createdAt: String(editing.createdAt || ""),
      updatedAt: nowDateTimeString(),
      serviceName: draft.serviceName.trim(),
      role: editing.role,
      address: editing.address,
      pricing: {
        currency: "USDC",
        amount: draft.pricingAmount.trim() || "0.01",
      },
      isActive: draft.isActive,
      summary: draft.summary.trim(),
      tags,
      status: draft.isActive ? "active" : "inactive",
      auth: {
        type: editing.auth?.type || "service_key",
        headerName: editing.auth?.headerName || "X-Credential",
      },
      healthCheck: {
        path: normalizedPath,
        method: draft.healthMethod,
        intervalSec: parsePositiveInt(draft.healthIntervalSec, 30),
        timeoutMs: parsePositiveInt(draft.healthTimeoutMs, 3000),
        successCodes: successCodes.length > 0 ? successCodes : [200],
        healthyThreshold: parsePositiveInt(draft.healthyThreshold, 2),
        unhealthyThreshold: parsePositiveInt(draft.unhealthyThreshold, 3),
      },
      constraints: {
        timeoutMs: parsePositiveInt(draft.constraintsTimeoutMs, CONSTRAINT_DEFAULTS.timeoutMs),
        maxResponseBytes: parsePositiveInt(draft.constraintsMaxResponseBytes, CONSTRAINT_DEFAULTS.maxResponseBytes),
        maxRequestBytes: parsePositiveInt(draft.constraintsMaxRequestBytes, CONSTRAINT_DEFAULTS.maxRequestBytes),
        maxQps: parsePositiveInt(draft.constraintsMaxQps, CONSTRAINT_DEFAULTS.maxQps),
      },
      forwarding: {
        requestIdHeader: draft.requestIdHeader.trim() || "X-Synapse-Request-Id",
        passThroughHeaders,
        injectHeaders,
        retryPolicy: {
          maxAttempts: parsePositiveInt(draft.retryMaxAttempts, 2),
          backoffMs: parsePositiveInt(draft.retryBackoffMs, 200),
          retryOnStatus: retryOnStatus.length > 0 ? retryOnStatus : [429, 500, 502, 503, 504],
        },
      },
      metering: {
        billingUnit: draft.billingUnit,
        billOnError: draft.billOnError,
        billableStatusClasses: editing.metering?.billableStatusClasses || [2],
        requestIdRequired: draft.requestIdRequired,
        responseSizeMetering: draft.responseSizeMetering,
      },
      invoke: {
        method: draft.invokeMethod.trim() || "POST",
        url: invokeUrl,
        targets: invokeTargets,
        timeoutMs: parsePositiveInt(draft.invokeTimeoutMs, 3000),
        request: {
          contentType: editing.invoke?.request?.contentType || "application/json",
          schema: requestSchema,
        },
        response: {
          schema: responseSchema,
        },
        headersTemplate: editing.invoke?.headersTemplate,
        examples: editing.invoke?.examples,
      },
    };

    const optimisticService: ServiceRegistryRecord = {
      ...editing,
      name: payload.serviceName,
      serviceName: payload.serviceName,
      summary: payload.summary || "",
      pricing: typeof payload.pricing === "string" ? payload.pricing : payload.pricing.amount,
      isActive: payload.isActive,
      status: payload.status,
      tags: payload.tags,
      auth: payload.auth,
      healthCheck: payload.healthCheck,
      constraints: payload.constraints,
      forwarding: payload.forwarding,
      metering: payload.metering,
      invoke: {
        ...payload.invoke,
        url: payload.invoke.url || editing.invoke?.url || editing.endpoint || "",
      },
      updatedAt: payload.updatedAt,
    };

    const prevServices = services;
    setServices((prev) => prev.map((svc) => (
      svc.serviceId === editing.serviceId ? optimisticService : svc
    )));
    upsertServiceRegistryListCache(optimisticService);

    setSaving(true);
    try {
      await updateServiceRegistry(payload, address);
      toast.success("Service updated");
      closeModal();
    } catch (err) {
      setServices(prevServices);
      invalidateServiceRegistryListCache(address);
      toast.error(err instanceof Error ? err.message : "Failed to update service");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-10 mx-auto max-w-7xl text-white bg-[#000000] min-h-screen space-y-6">
      <div className="border-b border-[#222222] pb-5">
        <h1 className="text-3xl md:text-4xl font-[800] tracking-tight text-white flex items-center gap-3">
          <Server className="w-8 h-8 text-[#22c55e]" />
          API Services
        </h1>
        <p className="mt-2 text-sm text-[#86868b]">
          Service endpoints, status, pricing, and readiness for marketplace routing.
        </p>
      </div>

      <div className="rounded-2xl border border-[#222222] bg-[#0a0a0a] p-3 flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 w-full lg:w-auto lg:flex-1">
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] w-full lg:w-[360px]">
            <Search className="w-4 h-4 text-[#86868b]" />
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch();
                }
              }}
              placeholder="Search Service ID or name"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#86868b]"
            />
          </label>
          <select
            value={statusInput}
            onChange={(e) => setStatusInput(e.target.value as NodeStatus)}
            className="px-3 py-2 rounded-lg border border-[#222222] bg-[#050505] text-sm text-white text-left outline-none min-w-[130px]"
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>
        </div>
        <div className="flex items-center gap-2 lg:justify-end">
          <button
            onClick={handleSearch}
            className="px-4 py-2 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] text-sm font-semibold hover:bg-[#22c55e] hover:text-black transition-colors"
          >
            Search
          </button>
          <Link
            href="/dashboard/services/deploy"
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg border border-[#3a3a3a] bg-[#050505] text-sm font-semibold text-white hover:border-[#22c55e]/50 hover:text-[#22c55e] transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Service
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[1.5rem] border border-[#222222] bg-[#0a0a0a]">
        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#222222] text-[10px] text-[#86868b] uppercase tracking-[0.2em] font-semibold bg-[#050505]">
              <th className="py-5 px-6">Service</th>
              <th className="py-5 px-6">Service ID</th>
              <th className="py-5 px-6">Pricing</th>
              <th className="py-5 px-6 text-center">Status</th>
              <th className="py-5 px-6 text-center">Callable</th>
              <th className="py-5 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#151515]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-14 text-center text-sm text-[#86868b]">
                  {loading ? "Loading API services..." : "No API services match the current filters."}
                </td>
              </tr>
            )}
            {pageRows.map((svc) => (
              <tr key={svc.id} className="hover:bg-[#111111] transition-colors">
                <td className="py-5 px-6">
                  <div className="font-semibold text-white">{svc.name || svc.serviceName || "Unnamed Service"}</div>
                  <div className="text-xs text-[#86868b] mt-1 flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" />
                    {svc.endpoint || "-"}
                  </div>
                </td>
                <td className="py-5 px-6 text-sm font-mono text-[#e5e5ea]">{svc.serviceId}</td>
                <td className="py-5 px-6 text-sm text-[#e5e5ea] font-mono">{formatPricing(svc.pricing)} / CALL</td>
                <td className="py-5 px-6 text-center">
                  {(() => {
                    const serviceStatus = normalizedServiceStatus(svc);
                    if (serviceStatus === "active") {
                      return (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#22c55e] border border-[#22c55e]/30 bg-[#22c55e]/10">
                          Active
                        </span>
                      );
                    }
                    if (serviceStatus === "inactive") {
                      return (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#f59e0b] border border-[#f59e0b]/30 bg-[#f59e0b]/10">
                          Inactive
                        </span>
                      );
                    }
                    return (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#ef4444] border border-[#ef4444]/30 bg-[#ef4444]/10">
                        Archived
                      </span>
                    );
                  })()}
                </td>
                <td className="py-5 px-6 text-center">
                  {isServiceRuntimeOnline(svc) ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#22c55e] border border-[#22c55e]/30 bg-[#22c55e]/10">
                      <Gauge className="w-3 h-3 mr-1" />
                      Callable
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold text-[#86868b] border border-[#333333] bg-[#111111]">
                      Unavailable
                    </span>
                  )}
                </td>
                <td className="py-5 px-6 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(svc)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-[#333333] hover:border-[#ffffff] text-white hover:bg-white hover:text-black transition-all"
                    >
                      Edit
                    </button>
                    <Link
                      href={`/provider/health?serviceId=${encodeURIComponent(svc.serviceId)}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-[#22c55e]/40 text-[#22c55e] hover:bg-[#22c55e] hover:text-black transition-all"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Health
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-[#86868b]">
        <div>
          Showing {(safePage - 1) * PAGE_SIZE + (filtered.length ? 1 : 0)}-
          {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Prev
          </button>
          <span className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#050505] text-white">
            {safePage} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            className="px-3 py-1.5 rounded-lg border border-[#222222] bg-[#0a0a0a] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#222222] bg-[#0a0a0a] p-4 text-xs text-[#86868b] flex items-center gap-2">
        <Shield className="w-4 h-4 text-[#22c55e]" />
        Publish flow requires at least one Access Key to protect provider endpoints with gateway signature validation.
      </div>

      {editing && draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between border-b border-[#1d1d1d] pb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Edit Service</h2>
                <p className="mt-1 text-xs text-[#86868b] font-mono">{editing.serviceId}</p>
              </div>
              <button
                onClick={closeModal}
                className="rounded-lg border border-[#333333] p-2 text-[#86868b] hover:text-white hover:border-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!editValidation.isValid && (
              <div className="mb-4 rounded-lg border border-[#7f1d1d] bg-[#2a0f12] px-4 py-3 text-sm text-[#fca5a5]">
                Validation failed. Fix highlighted fields to avoid `422 SERVICE_REGISTRATION_INVALID`.
              </div>
            )}

            <div className="space-y-6">
              <section className="rounded-xl border border-[#1d1d1d] bg-[#050505] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9ba0a5]">Basic Profile</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Service Name</span>
                    <input
                      value={draft.serviceName}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, serviceName: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.serviceName ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.serviceName && <p className="text-xs text-[#f87171]">{editValidation.errors.serviceName}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Unit Price (USDC)</span>
                    <input
                      value={draft.pricingAmount}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, pricingAmount: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.pricingAmount ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.pricingAmount && <p className="text-xs text-[#f87171]">{editValidation.errors.pricingAmount}</p>}
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">Summary</span>
                    <textarea
                      rows={2}
                      value={draft.summary}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, summary: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">Tags (comma separated)</span>
                    <input
                      value={draft.tagsText}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, tagsText: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-sm text-[#c6c6c9]">
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, isActive: e.target.checked } : prev))}
                      className="h-4 w-4 rounded border-[#333333] bg-[#111111] text-[#22c55e]"
                    />
                    <span>Service Active</span>
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-[#1d1d1d] bg-[#050505] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9ba0a5]">Health And Constraints</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">Health Path</span>
                    <input
                      value={draft.healthPath}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, healthPath: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.healthPath ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.healthPath && <p className="text-xs text-[#f87171]">{editValidation.errors.healthPath}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Health Method</span>
                    <select
                      value={draft.healthMethod}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, healthMethod: e.target.value as "GET" | "HEAD" | "POST" } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    >
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                      <option value="POST">POST</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Health Interval Sec</span>
                    <input
                      value={draft.healthIntervalSec}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, healthIntervalSec: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Health Timeout Ms</span>
                    <input
                      value={draft.healthTimeoutMs}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, healthTimeoutMs: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">Health Success Codes (comma separated)</span>
                    <input
                      value={draft.healthSuccessCodesText}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, healthSuccessCodesText: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Healthy Threshold</span>
                    <input
                      value={draft.healthyThreshold}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, healthyThreshold: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Unhealthy Threshold</span>
                    <input
                      value={draft.unhealthyThreshold}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, unhealthyThreshold: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Constraint Timeout Ms</span>
                    <input
                      value={draft.constraintsTimeoutMs}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, constraintsTimeoutMs: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsTimeoutMs ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">Platform hard limit: {CONSTRAINT_LIMITS.timeoutMs.min}-{CONSTRAINT_LIMITS.timeoutMs.max}</p>
                    {editValidation.errors.constraintsTimeoutMs && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsTimeoutMs}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Max Request Bytes</span>
                    <input
                      value={draft.constraintsMaxRequestBytes}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, constraintsMaxRequestBytes: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsMaxRequestBytes ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">Platform hard limit: {CONSTRAINT_LIMITS.maxRequestBytes.min}-{CONSTRAINT_LIMITS.maxRequestBytes.max}</p>
                    {editValidation.errors.constraintsMaxRequestBytes && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsMaxRequestBytes}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Max Response Bytes</span>
                    <input
                      value={draft.constraintsMaxResponseBytes}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, constraintsMaxResponseBytes: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsMaxResponseBytes ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">Platform hard limit: {CONSTRAINT_LIMITS.maxResponseBytes.min}-{CONSTRAINT_LIMITS.maxResponseBytes.max}</p>
                    {editValidation.errors.constraintsMaxResponseBytes && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsMaxResponseBytes}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Max QPS</span>
                    <input
                      value={draft.constraintsMaxQps}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, constraintsMaxQps: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.constraintsMaxQps ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    <p className="text-[11px] text-[#86868b]">Platform hard limit: {CONSTRAINT_LIMITS.maxQps.min}-{CONSTRAINT_LIMITS.maxQps.max}</p>
                    {editValidation.errors.constraintsMaxQps && <p className="text-xs text-[#f87171]">{editValidation.errors.constraintsMaxQps}</p>}
                  </label>
                </div>
              </section>

              <section className="rounded-xl border border-[#1d1d1d] bg-[#050505] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9ba0a5]">Invoke Contract</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Invoke Method</span>
                    <input
                      value={draft.invokeMethod}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, invokeMethod: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-2">
                    <span className="text-[#c6c6c9]">Invoke URL</span>
                    <input
                      value={
                        draft.invokeUrl ||
                        editing.endpoint ||
                        editing.invoke?.url ||
                        (Array.isArray(editing.invoke?.targets) ? (editing.invoke?.targets[0]?.url || "") : "")
                      }
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, invokeUrl: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.invokeUrl ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.invokeUrl && <p className="text-xs text-[#f87171]">{editValidation.errors.invokeUrl}</p>}
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="text-[#c6c6c9]">Invoke Timeout Ms</span>
                    <input
                      value={draft.invokeTimeoutMs}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, invokeTimeoutMs: e.target.value } : prev))}
                      className="w-full rounded-lg border border-[#2a2a2a] bg-[#050505] px-3 py-2 text-white outline-none focus:border-[#22c55e]/70"
                    />
                  </label>

                  <label className="space-y-2 text-sm md:col-span-3">
                    <span className="text-[#c6c6c9]">Invoke Targets (JSON Array)</span>
                    <textarea
                      rows={6}
                      value={draft.invokeTargetsJson}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, invokeTargetsJson: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.invokeTargetsJson ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.invokeTargetsJson && <p className="text-xs text-[#f87171]">{editValidation.errors.invokeTargetsJson}</p>}
                  </label>

                  <label className="space-y-2 text-sm md:col-span-3">
                    <span className="text-[#c6c6c9]">Request Schema (JSON)</span>
                    <textarea
                      rows={6}
                      value={draft.requestSchemaJson}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, requestSchemaJson: e.target.value } : prev))}
                      className={`w-full rounded-lg border bg-[#050505] px-3 py-2 font-mono text-xs text-white outline-none focus:border-[#22c55e]/70 ${editValidation.errors.requestSchemaJson ? "border-[#ef4444]" : "border-[#2a2a2a]"}`}
                    />
                    {editValidation.errors.requestSchemaJson && <p className="text-xs text-[#f87171]">{editValidation.errors.requestSchemaJson}</p>}
                  </label>

                  <label className="space-y-2 text-sm md:col-span-3">
                    <span className="text-[#c6c6c9]">Response Schema (JSON)</span>
                    <textarea
                      rows={6}
                      value={draft.responseSchemaJson}
                      onChange={(e) => setDraft((prev) => (prev ? { ...prev, responseSchemaJson: e.target.value } : prev))}
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
                Cancel
              </button>
              <button
                onClick={persistEdit}
                disabled={saving || !editValidation.isValid}
                className="rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/15 px-4 py-2 text-sm font-semibold text-[#22c55e] hover:bg-[#22c55e] hover:text-black disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
