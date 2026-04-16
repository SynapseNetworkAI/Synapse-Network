"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CircleHelp,
  Plus,
  Server,
  Wand2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import XSelect from "@/components/xui/XSelect";

import AuthMask from "@/components/AuthMask";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import SupportContactPanel from "@/components/shared/SupportContactPanel";
import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import { createServiceRegistry } from "@/utils/serviceApi";
import {
  buildProviderDeployGatewayPayloadPreview,
  buildProviderDeployStandardManifest,
  DEFAULT_SERVICE_AUTH_MODE,
  DEFAULT_SERVICE_BILLING_UNIT,
  DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES_TEXT,
  DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
  DEFAULT_SERVICE_HEALTH_METHOD,
  DEFAULT_SERVICE_HEALTH_PATH,
  DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT,
  DEFAULT_SERVICE_HEALTH_TIMEOUT_MS,
  DEFAULT_SERVICE_REQUEST_ID_HEADER,
  DEFAULT_SERVICE_SETTLEMENT_CURRENCY,
  DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET,
  DEFAULT_SERVICE_DEPLOY_DRAFT_CONFIG,
  DEFAULT_SERVICE_PRICING_AMOUNT,
  SERVICE_CONSTRAINT_LIMITS,
} from "@/utils/serviceStatus";

const PARSE_CURL_ENDPOINT = `${getGatewayBaseUrl()}/api/v1/services/parse-curl`;
const STORAGE_KEY = "synapse_manifest_v2_draft";
const SERVICE_ID_REGEX = /^[a-z0-9_-]{3,64}$/;
const SERVICE_NAME_MIN = 4;
const SERVICE_NAME_MAX = 80;
const DESCRIPTION_MIN = 12;
const DESCRIPTION_MAX = 240;
const WEIGHT_MIN = 1;
const WEIGHT_MAX = 1000;
const SUPPORTED_LANGUAGE_OPTIONS = ["en", "cn"] as const;
const DEFAULT_AI_PARSER_SAMPLE = String.raw`curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"关于坚持"}'
{"input_text":"关于坚持","quotes":["穷则独善其身，达则兼济天下。—— 孟子","路漫漫其修远兮，吾将上下而求索。—— 屈原","不积跬步，无以至千里。—— 荀子"]}`;

type DraftStatus = "draft" | "active" | "paused" | "archived";
type PriceModel = "fixed";
type BillingUnit = "per_call" | "per_success_call";

type RoutingTarget = {
  id: string;
  url: string;
  region: string;
  weight: number;
};

type ManifestDraft = {
  identity: {
    serviceId: string;
    serviceName: string;
    serviceSlug: string;
    manifestVersion: string;
    status: DraftStatus;
  };
  modelUsage: {
    descriptionForModel: string;
    taskCategory: string;
    capabilities: string[];
    limitations: string[];
    supportedLanguages: string[];
    examplesText: string;
  };
  ioSchema: {
    inputSchemaText: string;
    outputSchemaText: string;
  };
  billing: {
    priceModel: PriceModel;
    basePriceUsdc: string;
    settlementCurrency: string;
  };
  runtime: {
    endpointUrl: string;
    authMode: string;
    timeoutMs: number;
    maxRequestBytes: number;
    maxResponseBytes: number;
  };
  quality: {
    availabilitySlo: string;
    p95LatencyMs: string;
    successRate24h: string;
    region: string[];
    complianceTags: string[];
  };
  gatewayExtensions: {
    healthCheck: {
      method: "GET" | "POST" | "HEAD";
      path: string;
      intervalSec: number;
      timeoutMs: number;
      successCodesText: string;
    };
    routingTargets: RoutingTarget[];
    forwardingPolicy: {
      requestIdHeader: string;
    };
    meteringPolicy: {
      billingUnit: BillingUnit;
      billOnError: boolean;
      billableStatusClassesText: string;
      requestIdRequired: boolean;
      responseSizeMetering: boolean;
    };
    rateLimitPolicy: {
      maxQps: number;
    };
  };
};

type FieldGuideItem = {
  title: string;
  purpose: string;
  howToConfigure: string;
  platformUse: string;
  example?: string;
};

type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
  fallbackText?: string,
) => string;

const createDraftId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const emptyRoutingTarget = (): RoutingTarget => ({
  id: createDraftId(),
  url: "",
  region: "",
  weight: 100,
});

const createDefaultDraft = (): ManifestDraft => ({
  identity: {
    serviceId: "",
    serviceName: "",
    serviceSlug: "",
    manifestVersion: "1.0.0",
    status: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.status,
  },
  modelUsage: {
    descriptionForModel: "",
    taskCategory: "",
    capabilities: [],
    limitations: [],
    supportedLanguages: ["en"],
    examplesText: "[]",
  },
  ioSchema: {
    inputSchemaText: JSON.stringify({ type: "object", properties: {}, required: [] }, null, 2),
    outputSchemaText: JSON.stringify({ type: "object", properties: {} }, null, 2),
  },
  billing: {
    priceModel: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel,
    basePriceUsdc: DEFAULT_SERVICE_PRICING_AMOUNT,
    settlementCurrency: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.settlementCurrency,
  },
  runtime: {
    endpointUrl: "",
    authMode: DEFAULT_SERVICE_AUTH_MODE,
    timeoutMs: DEFAULT_SERVICE_DEPLOY_DRAFT_CONFIG.defaultTimeoutMs,
    maxRequestBytes: DEFAULT_SERVICE_DEPLOY_DRAFT_CONFIG.defaultMaxRequestBytes,
    maxResponseBytes: DEFAULT_SERVICE_DEPLOY_DRAFT_CONFIG.defaultMaxResponseBytes,
  },
  quality: {
    availabilitySlo: "0.995",
    p95LatencyMs: "",
    successRate24h: "",
    region: [],
    complianceTags: [],
  },
  gatewayExtensions: {
    healthCheck: {
      method: DEFAULT_SERVICE_HEALTH_METHOD,
      path: DEFAULT_SERVICE_HEALTH_PATH,
      intervalSec: DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
      timeoutMs: DEFAULT_SERVICE_HEALTH_TIMEOUT_MS,
      successCodesText: DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT,
    },
    routingTargets: [emptyRoutingTarget()],
    forwardingPolicy: {
      requestIdHeader: DEFAULT_SERVICE_REQUEST_ID_HEADER,
    },
    meteringPolicy: {
      billingUnit: DEFAULT_SERVICE_BILLING_UNIT,
      billOnError: false,
      billableStatusClassesText: DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES_TEXT,
      requestIdRequired: true,
      responseSizeMetering: true,
    },
    rateLimitPolicy: {
      maxQps: DEFAULT_SERVICE_DEPLOY_DRAFT_CONFIG.defaultMaxQps,
    },
  },
});

const slugifyValue = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-_]+|[-_]+$/g, "");

const normalizeServiceId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-_]+|[-_]+$/g, "");

const isValidCurlCommand = (raw: string): boolean => {
  const normalized = raw.replaceAll(/\\\r?\n/g, " ").trim();
  if (!normalized || !/^curl(\s|$)/i.test(normalized)) {
    return false;
  }
  return /(https?:\/\/[^\s'"\\]+)|(['"]https?:\/\/[^'"\\]+['"])/i.test(normalized);
};

const uniqueList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    const next = value.trim();
    if (!next) {
      return;
    }
    const key = next.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(next);
  });
  return normalized;
};

const parseJsonObject = (text: string): { valid: boolean; value: Record<string, unknown> } => {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, value: {} };
    }
    return { valid: true, value: parsed as Record<string, unknown> };
  } catch {
    return { valid: false, value: {} };
  }
};

const parseJsonArray = (text: string): { valid: boolean; value: unknown[] } => {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return { valid: false, value: [] };
    }
    return { valid: true, value: parsed };
  } catch {
    return { valid: false, value: [] };
  }
};

const parseNumberList = (text: string): number[] =>
  text
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number)
    .filter((item) => Number.isFinite(item));

const normalizeHealthPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "/health";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const firstValidationError = (errors: Record<string, string>): string | null => {
  const [first] = Object.values(errors);
  return first ?? null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string") {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return "";
};

const readNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

const readStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? uniqueList(value.map(String)) : [];
};

const normalizeSupportedLanguages = (values: string[]): string[] => {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is (typeof SUPPORTED_LANGUAGE_OPTIONS)[number] =>
      (SUPPORTED_LANGUAGE_OPTIONS as readonly string[]).includes(value),
    );

  if (normalized.length === 0) {
    return ["en"];
  }

  return [normalized[0]];
};

const applyIdentityOverrides = (draft: ManifestDraft, raw: Record<string, unknown>): void => {
  const serviceId = readString(raw.service_id, raw.serviceId, raw.agent_tool_name, raw.agentToolName);
  const serviceName = readString(raw.service_name, raw.serviceName);
  const serviceSlug = readString(raw.service_slug, raw.serviceSlug);
  const manifestVersion = readString(raw.manifest_version, raw.manifestVersion);

  if (serviceId) draft.identity.serviceId = normalizeServiceId(serviceId);
  if (serviceName) draft.identity.serviceName = serviceName;
  if (serviceSlug) draft.identity.serviceSlug = slugifyValue(serviceSlug);
  if (manifestVersion) draft.identity.manifestVersion = manifestVersion;
  draft.identity.status = DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.status;
};

const applyModelUsageOverrides = (draft: ManifestDraft, raw: Record<string, unknown>): void => {
  const description = readString(raw.description);
  const taskCategory = readString(raw.task_category);
  const modelUsage = asRecord(raw.model_usage);

  if (description) draft.modelUsage.descriptionForModel = description;
  if (taskCategory) draft.modelUsage.taskCategory = taskCategory;
  if (Array.isArray(raw.intent)) {
    draft.modelUsage.capabilities = uniqueList(raw.intent.map(String));
  }
  if (!modelUsage) {
    return;
  }

  const descriptionForModel = readString(modelUsage.description_for_model);
  const category = readString(modelUsage.task_category);
  if (descriptionForModel) draft.modelUsage.descriptionForModel = descriptionForModel;
  if (category) draft.modelUsage.taskCategory = category;

  draft.modelUsage.capabilities = readStringArray(modelUsage.capabilities).length
    ? readStringArray(modelUsage.capabilities)
    : draft.modelUsage.capabilities;
  draft.modelUsage.limitations = readStringArray(modelUsage.limitations).length
    ? readStringArray(modelUsage.limitations)
    : draft.modelUsage.limitations;
  draft.modelUsage.supportedLanguages = readStringArray(modelUsage.supported_languages).length
    ? normalizeSupportedLanguages(readStringArray(modelUsage.supported_languages))
    : draft.modelUsage.supportedLanguages;

  if (Array.isArray(modelUsage.examples)) {
    draft.modelUsage.examplesText = JSON.stringify(modelUsage.examples, null, 2);
  }
};

const applyIoSchemaOverrides = (draft: ManifestDraft, raw: Record<string, unknown>): void => {
  const ioSchema = asRecord(raw.io_schema);
  if (ioSchema?.input_schema) {
    draft.ioSchema.inputSchemaText = JSON.stringify(ioSchema.input_schema, null, 2);
  }
  if (ioSchema?.output_schema) {
    draft.ioSchema.outputSchemaText = JSON.stringify(ioSchema.output_schema, null, 2);
  }
  if (asRecord(raw.input_schema)) {
    draft.ioSchema.inputSchemaText = JSON.stringify(raw.input_schema, null, 2);
  }
  if (asRecord(raw.output_schema)) {
    draft.ioSchema.outputSchemaText = JSON.stringify(raw.output_schema, null, 2);
  }
};

const applyBillingOverrides = (draft: ManifestDraft, raw: Record<string, unknown>): void => {
  const billing = asRecord(raw.billing);
  const pricing = asRecord(raw.pricing);

  if (billing) {
    const basePriceUsdc = readString(billing.base_price_usdc);
    const settlementCurrency = readString(billing.settlement_currency);

    draft.billing.priceModel = DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel;
    if (basePriceUsdc) draft.billing.basePriceUsdc = basePriceUsdc;
    if (settlementCurrency) draft.billing.settlementCurrency = settlementCurrency;
  }

  if (!pricing) {
    return;
  }

  const amount = readString(pricing.amount);
  const currency = readString(pricing.currency);
  if (amount) draft.billing.basePriceUsdc = amount;
  if (currency) draft.billing.settlementCurrency = currency;
  draft.billing.priceModel = DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel;
};

const applyRuntimeRecord = (draft: ManifestDraft, runtime: Record<string, unknown>): void => {
  const endpointUrl = readString(runtime.endpoint_url);
  const authMode = readString(runtime.auth_mode);
  const timeoutMs = readNumber(runtime.timeout_ms);
  const maxPayloadBytes = readNumber(runtime.max_payload_bytes);
  const maxRequestBytes = readNumber(runtime.max_request_bytes);
  const maxResponseBytes = readNumber(runtime.max_response_bytes);

  if (endpointUrl) draft.runtime.endpointUrl = endpointUrl;
  if (authMode) draft.runtime.authMode = authMode;
  if (timeoutMs !== null) draft.runtime.timeoutMs = timeoutMs;
  if (maxRequestBytes !== null) draft.runtime.maxRequestBytes = maxRequestBytes;
  else if (maxPayloadBytes !== null) draft.runtime.maxRequestBytes = Math.min(maxPayloadBytes, SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max);
  if (maxResponseBytes !== null) draft.runtime.maxResponseBytes = maxResponseBytes;
  else if (maxPayloadBytes !== null) draft.runtime.maxResponseBytes = Math.min(maxPayloadBytes, SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max);
};

const applyConstraintRecord = (draft: ManifestDraft, constraints: Record<string, unknown>): void => {
  const timeoutMs = readNumber(constraints.timeout_ms);
  const maxQps = readNumber(constraints.max_qps);
  const maxRequestBytes = readNumber(constraints.max_request_bytes);
  const maxResponseBytes = readNumber(constraints.max_response_bytes);

  if (timeoutMs !== null) draft.runtime.timeoutMs = timeoutMs;
  if (maxQps !== null) draft.gatewayExtensions.rateLimitPolicy.maxQps = maxQps;
  if (maxRequestBytes !== null) draft.runtime.maxRequestBytes = maxRequestBytes;
  if (maxResponseBytes !== null) draft.runtime.maxResponseBytes = maxResponseBytes;
};

const applyRuntimeOverrides = (draft: ManifestDraft, raw: Record<string, unknown>): void => {
  const runtime = asRecord(raw.runtime);
  const constraints = asRecord(raw.constraints);
  const endpoint = readString(raw.endpoint);

  if (runtime) applyRuntimeRecord(draft, runtime);

  if (endpoint) draft.runtime.endpointUrl = endpoint;

  if (constraints) {
    applyConstraintRecord(draft, constraints);
  }
};

const applyHealthCheckRecord = (draft: ManifestDraft, healthCheck: Record<string, unknown>): void => {
  const path = readString(healthCheck.path);
  const timeoutMs = readNumber(healthCheck.timeout_ms);

  if (path) draft.gatewayExtensions.healthCheck.path = normalizeHealthPath(path);
  draft.gatewayExtensions.healthCheck.method = DEFAULT_SERVICE_HEALTH_METHOD;
  draft.gatewayExtensions.healthCheck.intervalSec = DEFAULT_SERVICE_HEALTH_INTERVAL_SEC;
  if (timeoutMs !== null) draft.gatewayExtensions.healthCheck.timeoutMs = timeoutMs;
  draft.gatewayExtensions.healthCheck.successCodesText = DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT;
};

const applyRoutingTargetsRecord = (draft: ManifestDraft, routingTargets: unknown[]): void => {
  if (routingTargets.length === 0) {
    return;
  }

  draft.gatewayExtensions.routingTargets = routingTargets.map((target) => {
    const targetPayload = asRecord(target);
    return {
      id: createDraftId(),
      url: readString(targetPayload?.url),
      region: readString(targetPayload?.region),
      weight: readNumber(targetPayload?.weight) ?? 100,
    };
  });
};

const applyForwardingPolicyRecord = (draft: ManifestDraft): void => {
  draft.gatewayExtensions.forwardingPolicy.requestIdHeader = DEFAULT_SERVICE_REQUEST_ID_HEADER;
};

const applyGatewayOverrides = (draft: ManifestDraft, raw: Record<string, unknown>): void => {
  const gatewayExtensions = asRecord(raw.gateway_extensions);
  const healthCheckPath = readString(raw.health_check);
  if (healthCheckPath) {
    draft.gatewayExtensions.healthCheck.path = normalizeHealthPath(healthCheckPath);
  }
  if (!gatewayExtensions) {
    return;
  }

  const healthCheck = asRecord(gatewayExtensions.health_check);
  if (healthCheck) applyHealthCheckRecord(draft, healthCheck);

  if (Array.isArray(gatewayExtensions.routing_targets)) {
    applyRoutingTargetsRecord(draft, gatewayExtensions.routing_targets);
  }

  const forwardingPolicy = asRecord(gatewayExtensions.forwarding_policy);
  if (forwardingPolicy) applyForwardingPolicyRecord(draft);

};

const collectIdentityErrors = (
  draft: ManifestDraft,
  errors: Record<string, string>,
  t: TranslateFn,
): void => {
  const serviceId = draft.identity.serviceId.trim();
  const serviceName = draft.identity.serviceName.trim();
  const manifestVersion = draft.identity.manifestVersion.trim();
  const descriptionForModel = draft.modelUsage.descriptionForModel.trim();

  if (!serviceId) {
    errors.serviceId = t("providerServiceDeployPage.validationServiceIdRequired");
  } else if (!SERVICE_ID_REGEX.test(serviceId)) {
    errors.serviceId = t("providerServiceDeployPage.validationServiceIdPattern");
  }
  if (!serviceName) {
    errors.serviceName = t("providerServiceDeployPage.validationServiceNameRequired");
  } else if (serviceName.length < SERVICE_NAME_MIN || serviceName.length > SERVICE_NAME_MAX) {
    errors.serviceName = t("providerServiceDeployPage.validationServiceNameLength", {
      min: SERVICE_NAME_MIN,
      max: SERVICE_NAME_MAX,
    });
  }
  if (!manifestVersion || !/^\d+\.\d+\.\d+$/.test(manifestVersion)) {
    errors.manifestVersion = t("providerServiceDeployPage.validationManifestVersion");
  }
  if (!descriptionForModel) {
    errors.descriptionForModel = t("providerServiceDeployPage.validationDescriptionRequired");
  } else if (descriptionForModel.length < DESCRIPTION_MIN || descriptionForModel.length > DESCRIPTION_MAX) {
    errors.descriptionForModel = t("providerServiceDeployPage.validationDescriptionLength", {
      min: DESCRIPTION_MIN,
      max: DESCRIPTION_MAX,
    });
  }
};

const collectSchemaErrors = (
  inputSchemaValid: boolean,
  outputSchemaValid: boolean,
  examplesValid: boolean,
  errors: Record<string, string>,
  t: TranslateFn,
): void => {
  if (!inputSchemaValid) errors.inputSchema = t("providerServiceDeployPage.validationInputSchema");
  if (!outputSchemaValid) errors.outputSchema = t("providerServiceDeployPage.validationOutputSchema");
  if (!examplesValid) errors.examples = t("providerServiceDeployPage.validationExamples");
};

const collectRuntimeErrors = (
  draft: ManifestDraft,
  normalizedTargets: Array<{ url: string; region?: string; weight: number }>,
  errors: Record<string, string>,
  t: TranslateFn,
): void => {
  const basePriceUsdc = Number(draft.billing.basePriceUsdc);

  if (!Number.isFinite(basePriceUsdc) || basePriceUsdc < 0) {
    errors.basePriceUsdc = t("providerServiceDeployPage.validationBasePrice");
  }
  if (!isHttpUrl(draft.runtime.endpointUrl.trim())) {
    errors.endpointUrl = t("providerServiceDeployPage.validationEndpointUrl");
  }
  if (draft.runtime.timeoutMs < SERVICE_CONSTRAINT_LIMITS.timeoutMs.min || draft.runtime.timeoutMs > SERVICE_CONSTRAINT_LIMITS.timeoutMs.max) {
    errors.timeoutMs = t("providerServiceDeployPage.validationTimeoutRange", {
      min: SERVICE_CONSTRAINT_LIMITS.timeoutMs.min,
      max: SERVICE_CONSTRAINT_LIMITS.timeoutMs.max,
    });
  }
  if (draft.runtime.maxRequestBytes < SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min || draft.runtime.maxRequestBytes > SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max) {
    errors.maxRequestBytes = t("providerServiceDeployPage.validationMaxRequestBytesRange", {
      min: SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min,
      max: SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max,
    });
  }
  if (draft.runtime.maxResponseBytes < SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min || draft.runtime.maxResponseBytes > SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max) {
    errors.maxResponseBytes = t("providerServiceDeployPage.validationMaxResponseBytesRange", {
      min: SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min,
      max: SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max,
    });
  }
  if (!normalizeHealthPath(draft.gatewayExtensions.healthCheck.path).startsWith("/")) {
    errors.healthPath = t("providerServiceDeployPage.validationHealthPath");
  }
  if (normalizedTargets.length === 0) {
    errors.routingTargets = t("providerServiceDeployPage.validationRoutingTargets");
  }
  if (draft.gatewayExtensions.routingTargets.some((target) => target.url.trim() && (target.weight < WEIGHT_MIN || target.weight > WEIGHT_MAX))) {
    errors.routingTargets = t("providerServiceDeployPage.validationTargetWeight", {
      min: WEIGHT_MIN,
      max: WEIGHT_MAX,
    });
  }
  if (draft.gatewayExtensions.rateLimitPolicy.maxQps < SERVICE_CONSTRAINT_LIMITS.maxQps.min || draft.gatewayExtensions.rateLimitPolicy.maxQps > SERVICE_CONSTRAINT_LIMITS.maxQps.max) {
    errors.maxQps = t("providerServiceDeployPage.validationMaxQpsRange", {
      min: SERVICE_CONSTRAINT_LIMITS.maxQps.min,
      max: SERVICE_CONSTRAINT_LIMITS.maxQps.max,
    });
  }
};

const validateDraft = (
  draft: ManifestDraft,
  inputSchemaValid: boolean,
  outputSchemaValid: boolean,
  examplesValid: boolean,
  normalizedTargets: Array<{ url: string; region?: string; weight: number }>,
  t: TranslateFn,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  collectIdentityErrors(draft, errors, t);
  collectSchemaErrors(inputSchemaValid, outputSchemaValid, examplesValid, errors, t);
  collectRuntimeErrors(draft, normalizedTargets, errors, t);

  return errors;
};

function FieldGuideHint({ item }: Readonly<{ item?: FieldGuideItem }>) {
  const { t } = useLanguage();

  if (!item) {
    return null;
  }

  return (
    <details className="relative inline-block align-middle group">
      <summary className="list-none cursor-pointer inline-flex items-center text-gray-500 hover:text-green-300">
        <CircleHelp className="h-3.5 w-3.5" />
      </summary>
      <div className="absolute z-30 mt-2 w-72 rounded-xl border border-gray-700 bg-[#0b0d12] p-3 text-[11px] shadow-2xl">
        <p className="font-semibold text-white">{item.title}</p>
        <p className="mt-2 text-gray-300">{item.purpose}</p>
        <p className="mt-2 text-gray-400">{t("providerServiceDeployPage.fieldGuideConfigureLabel")}: {item.howToConfigure}</p>
        <p className="mt-1 text-gray-400">{t("providerServiceDeployPage.fieldGuidePlatformLabel")}: {item.platformUse}</p>
        {item.example ? <p className="mt-1 text-green-300">{t("providerServiceDeployPage.fieldGuideExampleLabel")}: {item.example}</p> : null}
      </div>
    </details>
  );
}

function SectionCard({
  index,
  icon,
  title,
  summary,
  children,
}: Readonly<{
  index: string;
  icon: ReactNode;
  title: string;
  summary: string;
  children: ReactNode;
}>) {
  return (
    <section className="rounded-3xl border border-white/8 bg-[#0b0d12] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
      <div className="flex items-start justify-between gap-4 border-b border-white/8 pb-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-green-500/20 bg-green-500/10 text-green-300">
            {icon}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{index}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          </div>
        </div>
        <p className="max-w-md text-right text-sm text-zinc-500">{summary}</p>
      </div>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function FieldNote({ error, hint }: Readonly<{ error?: string; hint: string }>) {
  return error ? <p className="mt-2 text-xs text-amber-300">{error}</p> : <p className="mt-2 text-xs text-zinc-500">{hint}</p>;
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  guide,
  mono = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint: string;
  guide?: FieldGuideItem;
  mono?: boolean;
}>) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-200">
        <span>{label}</span>
        <FieldGuideHint item={guide} />
      </label>
      <input
        type="text"
        aria-label={label}
        className={`w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition focus:border-green-500 ${mono ? "font-mono" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  error,
  hint,
}: Readonly<{
  label: string;
  value: string | number;
  onChange: (value: number) => void;
  error?: string;
  hint: string;
}>) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-zinc-200">{label}</label>
      <input
        type="number"
        aria-label={label}
        className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-green-500"
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10) || 0)}
      />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

function TagEditor({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: Readonly<{
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  hint: string;
}>) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");

  const addValue = () => {
    const next = uniqueList([...values, draft]);
    if (next.length !== values.length) {
      onChange(next);
    }
    setDraft("");
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-zinc-200">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          aria-label={label}
          className="flex-1 rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition focus:border-green-500"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
        />
        <button type="button" onClick={addValue} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10">
          {t("providerServiceDeployPage.tagAddButton")}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className="inline-flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs text-green-200">
            {value}
            <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} className="text-green-400 transition hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function JsonEditor({
  label,
  value,
  onChange,
  error,
  hint,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint: string;
}>) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-zinc-200">{label}</label>
      <textarea
        aria-label={label}
        className="h-48 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-xs text-zinc-200 outline-none transition focus:border-green-500"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldNote error={error} hint={hint} />
    </div>
  );
}

function RoutingTargetsEditor({
  targets,
  onChange,
}: Readonly<{
  targets: RoutingTarget[];
  onChange: (next: RoutingTarget[]) => void;
}>) {
  const { t } = useLanguage();
  const updateTarget = (index: number, key: keyof RoutingTarget, value: string | number) => {
    const next = targets.map((target, targetIndex) => {
      if (targetIndex !== index) {
        return target;
      }
      return { ...target, [key]: value } as RoutingTarget;
    });
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {targets.map((target, index) => (
        <div key={target.id} className="grid gap-3 rounded-2xl border border-white/8 bg-black/60 p-4 md:grid-cols-[1.6fr_1fr_120px_44px]">
          <input
            type="text"
            aria-label={t("providerServiceDeployPage.routingTargetUrlAria")}
            className="rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-green-500"
            placeholder={t("providerServiceDeployPage.routingTargetUrlPlaceholder")}
            value={target.url}
            onChange={(event) => updateTarget(index, "url", event.target.value)}
          />
          <input
            type="text"
            aria-label={t("providerServiceDeployPage.routingTargetRegionAria")}
            className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition focus:border-green-500"
            placeholder={t("providerServiceDeployPage.routingTargetRegionPlaceholder")}
            value={target.region}
            onChange={(event) => updateTarget(index, "region", event.target.value)}
          />
          <input
            type="number"
            aria-label={t("providerServiceDeployPage.routingTargetWeightAria")}
            className="rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-green-500"
            value={target.weight}
            onChange={(event) => updateTarget(index, "weight", Number.parseInt(event.target.value, 10) || 0)}
          />
          <button
            type="button"
            aria-label={t("providerServiceDeployPage.routingTargetRemoveAria")}
            onClick={() => onChange(targets.length === 1 ? [emptyRoutingTarget()] : targets.filter((_, targetIndex) => targetIndex !== index))}
            className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...targets, emptyRoutingTarget()])}
        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
      >
        <Plus className="h-4 w-4" />
        {t("providerServiceDeployPage.routingTargetAdd")}
      </button>
    </div>
  );
}

const normalizeParsedManifest = (current: ManifestDraft, raw: Record<string, unknown>): ManifestDraft => {
  const next = structuredClone(current);
  applyIdentityOverrides(next, raw);
  applyModelUsageOverrides(next, raw);
  applyIoSchemaOverrides(next, raw);
  applyBillingOverrides(next, raw);
  applyRuntimeOverrides(next, raw);
  applyGatewayOverrides(next, raw);
  return next;
};

export default function DeployManifestPage() {
  const router = useRouter();
  const { address } = useAccount();
  const { t } = useLanguage();

  const [draft, setDraft] = useState<ManifestDraft>(createDefaultDraft);
  const [hasDraft, setHasDraft] = useState(false);
  const [showAIModal, setShowAIModal] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [serviceIdTouched, setServiceIdTouched] = useState(false);
  const [serviceSlugTouched, setServiceSlugTouched] = useState(false);
  const [aiCurl, setAICurl] = useState("");
  const [aiResponse, setAIResponse] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  const closeDeployPage = useCallback(() => {
    router.push("/provider/services");
  }, [router]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setHasDraft(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  const restoreDraft = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as ManifestDraft;
      parsed.identity.status = DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.status;
      parsed.modelUsage.supportedLanguages = normalizeSupportedLanguages(parsed.modelUsage.supportedLanguages ?? []);
      parsed.billing.priceModel = DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel;
      parsed.gatewayExtensions.healthCheck.method = DEFAULT_SERVICE_HEALTH_METHOD;
      parsed.gatewayExtensions.healthCheck.intervalSec = DEFAULT_SERVICE_HEALTH_INTERVAL_SEC;
      parsed.gatewayExtensions.healthCheck.successCodesText = DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT;
      parsed.gatewayExtensions.forwardingPolicy.requestIdHeader = DEFAULT_SERVICE_REQUEST_ID_HEADER;
      setDraft(parsed);
      setServiceIdTouched(Boolean(parsed.identity.serviceId.trim()));
      setServiceSlugTouched(Boolean(parsed.identity.serviceSlug.trim()));
      setHasDraft(false);
      toast.success(t("providerServiceDeployPage.draftRestored"));
    } catch {
      toast.error(t("providerServiceDeployPage.corruptedDraft"));
    }
  };

  const updateIdentity = <K extends keyof ManifestDraft["identity"]>(key: K, value: ManifestDraft["identity"][K]) => {
    setDraft((current) => ({
      ...current,
      identity: {
        ...current.identity,
        [key]: value,
      },
    }));
  };

  const updateServiceName = (value: string) => {
    setDraft((current) => {
      const derivedServiceId = normalizeServiceId(value);
      const derivedSlug = slugifyValue(value);
      return {
        ...current,
        identity: {
          ...current.identity,
          serviceName: value,
          serviceId: serviceIdTouched ? current.identity.serviceId : derivedServiceId,
          serviceSlug: serviceSlugTouched ? current.identity.serviceSlug : derivedSlug,
        },
      };
    });
  };

  const updateServiceId = (value: string) => {
    setServiceIdTouched(true);
    updateIdentity("serviceId", normalizeServiceId(value));
  };

  const updateServiceSlug = (value: string) => {
    setServiceSlugTouched(true);
    updateIdentity("serviceSlug", slugifyValue(value));
  };

  const resyncDerivedIdentity = () => {
    setServiceIdTouched(false);
    setServiceSlugTouched(false);
    setDraft((current) => ({
      ...current,
      identity: {
        ...current.identity,
        serviceId: normalizeServiceId(current.identity.serviceName),
        serviceSlug: slugifyValue(current.identity.serviceName),
      },
    }));
  };

  const updateModelUsage = <K extends keyof ManifestDraft["modelUsage"]>(key: K, value: ManifestDraft["modelUsage"][K]) => {
    setDraft((current) => ({
      ...current,
      modelUsage: {
        ...current.modelUsage,
        [key]: value,
      },
    }));
  };

  const updateIoSchema = <K extends keyof ManifestDraft["ioSchema"]>(key: K, value: ManifestDraft["ioSchema"][K]) => {
    setDraft((current) => ({
      ...current,
      ioSchema: {
        ...current.ioSchema,
        [key]: value,
      },
    }));
  };

  const updateBilling = <K extends keyof ManifestDraft["billing"]>(key: K, value: ManifestDraft["billing"][K]) => {
    setDraft((current) => ({
      ...current,
      billing: {
        ...current.billing,
        [key]: value,
      },
    }));
  };

  const updateRuntime = <K extends keyof ManifestDraft["runtime"]>(key: K, value: ManifestDraft["runtime"][K]) => {
    setDraft((current) => ({
      ...current,
      runtime: {
        ...current.runtime,
        [key]: value,
      },
    }));
  };

  const updateHealthCheck = <K extends keyof ManifestDraft["gatewayExtensions"]["healthCheck"]>(
    key: K,
    value: ManifestDraft["gatewayExtensions"]["healthCheck"][K],
  ) => {
    setDraft((current) => ({
      ...current,
      gatewayExtensions: {
        ...current.gatewayExtensions,
        healthCheck: {
          ...current.gatewayExtensions.healthCheck,
          [key]: value,
        },
      },
    }));
  };

  const updateRateLimitPolicy = (value: number) => {
    setDraft((current) => ({
      ...current,
      gatewayExtensions: {
        ...current.gatewayExtensions,
        rateLimitPolicy: {
          maxQps: value,
        },
      },
    }));
  };

  const inputSchema = useMemo(() => parseJsonObject(draft.ioSchema.inputSchemaText), [draft.ioSchema.inputSchemaText]);
  const outputSchema = useMemo(() => parseJsonObject(draft.ioSchema.outputSchemaText), [draft.ioSchema.outputSchemaText]);
  const examples = useMemo(() => parseJsonArray(draft.modelUsage.examplesText), [draft.modelUsage.examplesText]);
  const successCodes = useMemo(() => parseNumberList(draft.gatewayExtensions.healthCheck.successCodesText), [draft.gatewayExtensions.healthCheck.successCodesText]);
  const fieldGuides = useMemo<Record<string, FieldGuideItem>>(
    () => ({
      serviceId: {
        title: t("providerServiceDeployPage.fieldGuideServiceIdTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideServiceIdPurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideServiceIdHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideServiceIdPlatform"),
        example: t("providerServiceDeployPage.fieldGuideServiceIdExample"),
      },
      serviceName: {
        title: t("providerServiceDeployPage.fieldGuideServiceNameTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideServiceNamePurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideServiceNameHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideServiceNamePlatform"),
        example: t("providerServiceDeployPage.fieldGuideServiceNameExample"),
      },
      descriptionForModel: {
        title: t("providerServiceDeployPage.fieldGuideDescriptionTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideDescriptionPurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideDescriptionHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideDescriptionPlatform"),
      },
      taskCategory: {
        title: t("providerServiceDeployPage.fieldGuideTaskCategoryTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideTaskCategoryPurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideTaskCategoryHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideTaskCategoryPlatform"),
      },
      runtime: {
        title: t("providerServiceDeployPage.fieldGuideRuntimeTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideRuntimePurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideRuntimeHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideRuntimePlatform"),
      },
      billing: {
        title: t("providerServiceDeployPage.fieldGuideBillingTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideBillingPurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideBillingHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideBillingPlatform"),
      },
      routingTargets: {
        title: t("providerServiceDeployPage.fieldGuideRoutingTargetsTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideRoutingTargetsPurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideRoutingTargetsHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideRoutingTargetsPlatform"),
      },
      ioSchema: {
        title: t("providerServiceDeployPage.fieldGuideIoSchemaTitle"),
        purpose: t("providerServiceDeployPage.fieldGuideIoSchemaPurpose"),
        howToConfigure: t("providerServiceDeployPage.fieldGuideIoSchemaHow"),
        platformUse: t("providerServiceDeployPage.fieldGuideIoSchemaPlatform"),
      },
    }),
    [t],
  );

  const normalizedTargets = useMemo(() => {
    const validTargets = draft.gatewayExtensions.routingTargets.filter((target) => isHttpUrl(target.url.trim()));
    if (validTargets.length > 0) {
      return validTargets.map((target, index) => ({
        url: target.url.trim(),
        region: target.region.trim() || undefined,
        weight: target.weight || (index === 0 ? 100 : 80),
      }));
    }
    if (isHttpUrl(draft.runtime.endpointUrl.trim())) {
      return [
        {
          url: draft.runtime.endpointUrl.trim(),
          region: undefined,
          weight: 100,
        },
      ];
    }
    return [];
  }, [draft.gatewayExtensions.routingTargets, draft.runtime.endpointUrl]);

  const fieldErrors = useMemo(
    () => validateDraft(draft, inputSchema.valid, outputSchema.valid, examples.valid, normalizedTargets, t),
    [draft, inputSchema.valid, outputSchema.valid, examples.valid, normalizedTargets, t],
  );

  const standardManifest = useMemo(
    () => buildProviderDeployStandardManifest({
      draft,
      inputSchema: inputSchema.value,
      outputSchema: outputSchema.value,
      examples: examples.value,
      successCodes,
      normalizedTargets,
    }),
    [draft, examples.value, inputSchema.value, outputSchema.value, successCodes, normalizedTargets],
  );

  const gatewayPayloadPreview = useMemo(
    () => buildProviderDeployGatewayPayloadPreview({
      draft,
      address,
      inputSchema: inputSchema.value,
      outputSchema: outputSchema.value,
      examples: examples.value,
      successCodes,
      normalizedTargets,
    }),
    [draft, address, normalizedTargets, inputSchema.value, outputSchema.value, successCodes, examples.value],
  );

  const aiCurlLooksValid = useMemo(() => isValidCurlCommand(aiCurl), [aiCurl]);
  const parsedAiResponse = useMemo(() => {
    if (!aiResponse.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(aiResponse);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [aiResponse]);

  const nextBlockingIssue = firstValidationError(fieldErrors);

  const openParser = () => {
    setAICurl("");
    setAIResponse("");
    setShowAIModal(true);
  };

  const closeParser = () => {
    setAICurl("");
    setAIResponse("");
    setShowAIModal(false);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (showAIModal) {
        closeParser();
        return;
      }

      closeDeployPage();
    };

    globalThis.window.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDeployPage, showAIModal]);

  const autofillAIMagic = async () => {
    setIsAiGenerating(true);
    try {
      if (!aiCurlLooksValid) {
        throw new Error(t("providerServiceDeployPage.parserInvalidCurl"));
      }
      if (!address) {
        throw new Error(t("providerServiceDeployPage.parserWalletMissing"));
      }

      const response = await fetch(PARSE_CURL_ENDPOINT, {
        method: "POST",
        headers: buildAuthedHeaders(address),
        body: JSON.stringify({
          curlCommand: aiCurl,
          model: "deepseek-chat",
          currentManifest: standardManifest,
        }),
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(normalizeAuthApiError(raw || t("providerServiceDeployPage.parserFailed"), response.status));
      }

      const payload = (await response.json()) as {
        status?: string;
        data?: unknown;
        parsed?: unknown;
        manifest?: unknown;
        result?: unknown;
        detail?: string;
      };

      if (payload.status !== "success") {
        throw new Error(payload.detail || t("providerServiceDeployPage.parserUnknownError"));
      }

      const parsed = payload.data ?? payload.parsed ?? payload.manifest ?? payload.result;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(t("providerServiceDeployPage.parserInvalidResponse"));
      }

      setAIResponse(JSON.stringify(parsed, null, 2));
      toast.success(t("providerServiceDeployPage.parserGeneratedToast"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("providerServiceDeployPage.parserFailed");
      toast.error(message);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const confirmAndInject = () => {
    if (!parsedAiResponse) {
      toast.error(t("providerServiceDeployPage.parserExpectedJsonError"));
      return;
    }

    setDraft((current) => normalizeParsedManifest(current, parsedAiResponse));
    setServiceIdTouched(true);
    setServiceSlugTouched(true);
    closeParser();
    toast.success(t("providerServiceDeployPage.parserInjectedToast"));
  };

  const submitDeploy = async () => {
    if (isAiGenerating) {
      toast.error(t("providerServiceDeployPage.submitGeneratedAssetsPending"));
      return;
    }
    if (nextBlockingIssue) {
      toast.error(nextBlockingIssue);
      return;
    }
    if (!address) {
      toast.error(t("providerServiceDeployPage.submitWalletMissing"));
      return;
    }

    setIsDeploying(true);
    try {
      await createServiceRegistry(gatewayPayloadPreview, address);
      localStorage.removeItem(STORAGE_KEY);
      toast.success(t("providerServiceDeployPage.submitSuccess"));
      router.replace("/provider/services");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("providerServiceDeployPage.submitFailed");
      toast.error(message);
    } finally {
      setIsDeploying(false);
    }
  };

  let deploymentLabel = t("providerServiceDeployPage.deploymentLabelCreate");
  if (isDeploying) {
    deploymentLabel = t("providerServiceDeployPage.deploymentLabelCreating");
  } else if (isAiGenerating) {
    deploymentLabel = t("providerServiceDeployPage.deploymentLabelWaitingForAssets");
  } else if (nextBlockingIssue) {
    deploymentLabel = t("providerServiceDeployPage.deploymentLabelFix");
  }

  const deploymentBlockingText = isAiGenerating
    ? t("providerServiceDeployPage.submitGeneratedAssetsPending")
    : nextBlockingIssue;

  return (
    <AuthMask
      allowChallengeAuthorize={false}
      sessionHelpText={t("providerServiceDeployPage.sessionHelpText")}
      sessionRecoveryHref="/provider/services"
      sessionRecoveryLabel={t("providerServiceDeployPage.sessionRecoveryLabel")}
    >
      <div className="min-h-[calc(100vh-80px)] bg-[#050505]">
        <div className="mx-auto max-w-[1120px] px-4 py-6 xl:px-6">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.12),transparent_28%),linear-gradient(180deg,#0c0f14,#07090d)] p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Link href="/provider/services" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-green-300">
                    <ArrowLeft className="h-4 w-4" />
                    {t("providerServiceDeployPage.backToApiServices")}
                  </Link>
                  <div className="mt-5 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-green-500/20 bg-green-500/10 text-green-300">
                      <Server className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">{t("providerServiceDeployPage.eyebrow")}</p>
                      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{t("providerServiceDeployPage.title")}</h1>
                    </div>
                  </div>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-400">
                    {t("providerServiceDeployPage.heroDescription")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={closeDeployPage}
                    aria-label={t("providerServiceDeployPage.closePageAria")}
                    className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-3 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  {hasDraft ? (
                    <button
                      type="button"
                      onClick={restoreDraft}
                      className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-200 transition hover:bg-amber-500/15"
                    >
                      {t("providerServiceDeployPage.restoreDraft")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={openParser}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    <Wand2 className="h-4 w-4" />
                    {t("providerServiceDeployPage.aiAssist")}
                  </button>
                </div>
              </div>
            </div>

            <SectionCard
              index="01"
              icon={<Server className="h-5 w-5" />}
              title={t("providerServiceDeployPage.sectionQuickPublishTitle")}
              summary={t("providerServiceDeployPage.sectionQuickPublishSummary")}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label={t("providerServiceDeployPage.serviceNameLabel")}
                  value={draft.identity.serviceName}
                  onChange={updateServiceName}
                  placeholder={t("providerServiceDeployPage.serviceNamePlaceholder")}
                  error={fieldErrors.serviceName}
                  hint={t("providerServiceDeployPage.serviceNameHint")}
                  guide={fieldGuides.serviceName}
                />
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <span>{t("providerServiceDeployPage.serviceIdLabel")}</span>
                      <FieldGuideHint item={fieldGuides.serviceId} />
                    </label>
                    <button
                      type="button"
                      onClick={resyncDerivedIdentity}
                      className="text-xs font-medium text-green-300 transition hover:text-green-200"
                    >
                      {t("providerServiceDeployPage.serviceIdResync")}
                    </button>
                  </div>
                  <input
                    type="text"
                    aria-label={t("providerServiceDeployPage.serviceIdLabel")}
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-green-500"
                    value={draft.identity.serviceId}
                    onChange={(event) => updateServiceId(event.target.value)}
                    placeholder={t("providerServiceDeployPage.serviceIdPlaceholder")}
                  />
                  <FieldNote
                    error={fieldErrors.serviceId}
                    hint={serviceIdTouched
                      ? t("providerServiceDeployPage.serviceIdManualHint")
                      : t("providerServiceDeployPage.serviceIdResyncHint")}
                  />
                </div>
                <TextField
                  label={t("providerServiceDeployPage.endpointLabel")}
                  value={draft.runtime.endpointUrl}
                  onChange={(value) => updateRuntime("endpointUrl", value)}
                  placeholder={t("providerServiceDeployPage.endpointPlaceholder")}
                  error={fieldErrors.endpointUrl}
                  hint={t("providerServiceDeployPage.endpointHint")}
                  guide={fieldGuides.runtime}
                  mono
                />
                <TextField
                  label={t("providerServiceDeployPage.priceLabel")}
                  value={draft.billing.basePriceUsdc}
                  onChange={(value) => updateBilling("basePriceUsdc", value)}
                  placeholder={t("providerServiceDeployPage.pricePlaceholder")}
                  error={fieldErrors.basePriceUsdc}
                  hint={t("providerServiceDeployPage.priceHint")}
                  guide={fieldGuides.billing}
                  mono
                />
              </div>

              <TextField
                label={t("providerServiceDeployPage.descriptionLabel")}
                value={draft.modelUsage.descriptionForModel}
                onChange={(value) => updateModelUsage("descriptionForModel", value)}
                placeholder={t("providerServiceDeployPage.descriptionPlaceholder")}
                error={fieldErrors.descriptionForModel}
                hint={t("providerServiceDeployPage.descriptionHint")}
                guide={fieldGuides.descriptionForModel}
              />

              <div className="grid gap-5 xl:grid-cols-2">
                <JsonEditor
                  label={t("providerServiceDeployPage.inputSchemaLabel")}
                  value={draft.ioSchema.inputSchemaText}
                  onChange={(value) => updateIoSchema("inputSchemaText", value)}
                  error={fieldErrors.inputSchema}
                  hint={t("providerServiceDeployPage.inputSchemaHint")}
                />
                <JsonEditor
                  label={t("providerServiceDeployPage.outputSchemaLabel")}
                  value={draft.ioSchema.outputSchemaText}
                  onChange={(value) => updateIoSchema("outputSchemaText", value)}
                  error={fieldErrors.outputSchema}
                  hint={t("providerServiceDeployPage.outputSchemaHint")}
                />
              </div>

              <details className="rounded-2xl border border-white/8 bg-black/45 p-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-white">
                  {t("providerServiceDeployPage.optionalMetadataTitle")}
                </summary>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {t("providerServiceDeployPage.optionalMetadataDescription")}
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <TextField
                    label={t("providerServiceDeployPage.taskCategoryLabel")}
                    value={draft.modelUsage.taskCategory}
                    onChange={(value) => updateModelUsage("taskCategory", value)}
                    placeholder={t("providerServiceDeployPage.taskCategoryPlaceholder")}
                    hint={t("providerServiceDeployPage.taskCategoryHint")}
                    guide={fieldGuides.taskCategory}
                    mono
                  />
                  <div>
                    <label htmlFor="supported-languages" className="mb-1.5 block text-sm font-medium text-zinc-200">{t("providerServiceDeployPage.supportedLanguagesLabel")}</label>
                    <XSelect
                      id="supported-languages"
                      value={normalizeSupportedLanguages(draft.modelUsage.supportedLanguages)[0]}
                      onChange={(next) => updateModelUsage("supportedLanguages", [next])}
                      options={[
                        { value: "en", label: t("language.en") },
                        { value: "cn", label: t("language.zh") },
                      ]}
                      triggerClassName="inline-flex min-h-[50px] w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white transition focus:border-green-500"
                    />
                    <FieldNote hint={t("providerServiceDeployPage.supportedLanguagesHint")} />
                  </div>
                </div>
                <div className="mt-4 grid gap-5 xl:grid-cols-2">
                  <TagEditor
                    label={t("providerServiceDeployPage.capabilitiesLabel")}
                    values={draft.modelUsage.capabilities}
                    onChange={(next) => updateModelUsage("capabilities", next)}
                    placeholder={t("providerServiceDeployPage.capabilitiesPlaceholder")}
                    hint={t("providerServiceDeployPage.capabilitiesHint")}
                  />
                  <TagEditor
                    label={t("providerServiceDeployPage.limitationsLabel")}
                    values={draft.modelUsage.limitations}
                    onChange={(next) => updateModelUsage("limitations", next)}
                    placeholder={t("providerServiceDeployPage.limitationsPlaceholder")}
                    hint={t("providerServiceDeployPage.limitationsHint")}
                  />
                </div>
                <div className="mt-4">
                  <JsonEditor
                    label={t("providerServiceDeployPage.examplesLabel")}
                    value={draft.modelUsage.examplesText}
                    onChange={(value) => updateModelUsage("examplesText", value)}
                    error={fieldErrors.examples}
                    hint={t("providerServiceDeployPage.examplesHint")}
                  />
                </div>
              </details>
            </SectionCard>

            <section className="rounded-3xl border border-white/8 bg-[#0b0d12] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{t("providerServiceDeployPage.advancedEyebrow")}</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{t("providerServiceDeployPage.advancedTitle")}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                    {t("providerServiceDeployPage.advancedDescription")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((current) => !current)}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  {showAdvanced ? t("providerServiceDeployPage.advancedHide") : t("providerServiceDeployPage.advancedShow")}
                </button>
              </div>

              {showAdvanced ? (
                <div className="mt-5 space-y-5">
                  <div className="grid gap-4 md:grid-cols-3">
                    <TextField
                      label={t("providerServiceDeployPage.versionLabel")}
                      value={draft.identity.manifestVersion}
                      onChange={(value) => updateIdentity("manifestVersion", value)}
                      placeholder={t("providerServiceDeployPage.versionPlaceholder")}
                      error={fieldErrors.manifestVersion}
                      hint={t("providerServiceDeployPage.versionHint")}
                      mono
                    />
                    <TextField
                      label={t("providerServiceDeployPage.slugLabel")}
                      value={draft.identity.serviceSlug}
                      onChange={updateServiceSlug}
                      placeholder={t("providerServiceDeployPage.slugPlaceholder")}
                      hint={serviceSlugTouched
                        ? t("providerServiceDeployPage.slugHintManual")
                        : t("providerServiceDeployPage.slugHintAuto")}
                      mono
                    />
                    <TextField
                      label={t("providerServiceDeployPage.settlementCurrencyLabel")}
                      value={draft.billing.settlementCurrency}
                      onChange={(value) => updateBilling("settlementCurrency", value.toUpperCase())}
                      placeholder={t("providerServiceDeployPage.settlementCurrencyPlaceholder", undefined, DEFAULT_SERVICE_SETTLEMENT_CURRENCY)}
                      hint={t("providerServiceDeployPage.settlementCurrencyHint")}
                      mono
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <TextField
                      label={t("providerServiceDeployPage.authModeLabel")}
                      value={draft.runtime.authMode}
                      onChange={(value) => updateRuntime("authMode", value)}
                      placeholder={t("providerServiceDeployPage.authModePlaceholder", undefined, DEFAULT_SERVICE_AUTH_MODE)}
                      hint={t("providerServiceDeployPage.authModeHint")}
                      mono
                    />
                    <NumberField
                      label={t("providerServiceDeployPage.timeoutLabel")}
                      value={draft.runtime.timeoutMs}
                      onChange={(value) => updateRuntime("timeoutMs", value)}
                      error={fieldErrors.timeoutMs}
                      hint={t("providerServiceDeployPage.timeoutHint", {
                        min: SERVICE_CONSTRAINT_LIMITS.timeoutMs.min,
                        max: SERVICE_CONSTRAINT_LIMITS.timeoutMs.max,
                      })}
                    />
                    <NumberField
                      label={t("providerServiceDeployPage.rateLimitLabel")}
                      value={draft.gatewayExtensions.rateLimitPolicy.maxQps}
                      onChange={updateRateLimitPolicy}
                      error={fieldErrors.maxQps}
                      hint={t("providerServiceDeployPage.rateLimitHint", {
                        min: SERVICE_CONSTRAINT_LIMITS.maxQps.min,
                        max: SERVICE_CONSTRAINT_LIMITS.maxQps.max,
                      })}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <NumberField
                      label={t("providerServiceDeployPage.maxRequestBytesLabel")}
                      value={draft.runtime.maxRequestBytes}
                      onChange={(value) => updateRuntime("maxRequestBytes", value)}
                      error={fieldErrors.maxRequestBytes}
                      hint={t("providerServiceDeployPage.maxRequestBytesHint", {
                        min: SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min,
                        max: SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max,
                      })}
                    />
                    <NumberField
                      label={t("providerServiceDeployPage.maxResponseBytesLabel")}
                      value={draft.runtime.maxResponseBytes}
                      onChange={(value) => updateRuntime("maxResponseBytes", value)}
                      error={fieldErrors.maxResponseBytes}
                      hint={t("providerServiceDeployPage.maxResponseBytesHint", {
                        min: SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min,
                        max: SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max,
                      })}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      label={t("providerServiceDeployPage.healthPathLabel")}
                      value={draft.gatewayExtensions.healthCheck.path}
                      onChange={(value) => updateHealthCheck("path", value)}
                      placeholder={t("providerServiceDeployPage.healthPathPlaceholder")}
                      error={fieldErrors.healthPath}
                      hint={t("providerServiceDeployPage.healthPathHint")}
                    />
                    <NumberField
                      label={t("providerServiceDeployPage.healthTimeoutLabel")}
                      value={draft.gatewayExtensions.healthCheck.timeoutMs}
                      onChange={(value) => updateHealthCheck("timeoutMs", value)}
                      hint={t("providerServiceDeployPage.healthTimeoutHint")}
                    />
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-black/45 p-4">
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <span>{t("providerServiceDeployPage.routingTargetsLabel")}</span>
                      <FieldGuideHint item={fieldGuides.routingTargets} />
                    </label>
                    <RoutingTargetsEditor
                      targets={draft.gatewayExtensions.routingTargets}
                      onChange={(next) =>
                        setDraft((current) => ({
                          ...current,
                          gatewayExtensions: {
                            ...current.gatewayExtensions,
                            routingTargets: next,
                          },
                        }))
                      }
                    />
                    <FieldNote error={fieldErrors.routingTargets} hint={t("providerServiceDeployPage.routingTargetsHint")} />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/8 bg-black/60 p-4 text-sm text-zinc-400">
                      <p className="font-medium text-white">{t("providerServiceDeployPage.defaultsCardTitle")}</p>
                      <p className="mt-2 leading-6">
                        {t("providerServiceDeployPage.defaultsCardDescription", {
                          method: DEFAULT_SERVICE_HEALTH_METHOD,
                          codes: DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT,
                        })}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-black/60 p-4 text-sm text-zinc-400">
                      <p className="font-medium text-white">{t("providerServiceDeployPage.meteringCardTitle")}</p>
                      <p className="mt-2 leading-6">
                        {t("providerServiceDeployPage.meteringCardDescription")}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-white/8 bg-[#0b0d12] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{t("providerServiceDeployPage.deployEyebrow")}</p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{t("providerServiceDeployPage.deployTitle")}</h2>
                  <p className={`mt-2 text-sm ${deploymentBlockingText ? "text-amber-300" : "text-zinc-500"}`}>
                    {deploymentBlockingText || t("providerServiceDeployPage.deploymentReadyText")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={submitDeploy}
                  disabled={isDeploying || isAiGenerating || Boolean(nextBlockingIssue)}
                  className="inline-flex min-w-[280px] items-center justify-center rounded-2xl bg-green-500 px-5 py-4 text-sm font-semibold text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deploymentLabel}
                </button>
              </div>
            </section>

            <SupportContactPanel
              title={t("providerServiceDeployPage.supportTitle")}
              description={t("providerServiceDeployPage.supportDescription")}
              actionLabel={t("providerServiceDeployPage.supportAction")}
              subject="Synapse provider service publish support"
            />

            {showAIModal ? (
              <div className="x-dialog-shell x-modal-overlay">
                <button
                  type="button"
                  aria-label={t("providerServiceDeployPage.closeParserAria")}
                  onClick={closeParser}
                  className="absolute inset-0"
                />
                <div className="x-modal-flat x-modal-surface relative z-10 flex max-h-[92vh] max-w-6xl flex-col border border-green-900/40 shadow-[0_0_50px_rgba(34,197,94,0.12)]">
                  <div className="x-modal-header border-b border-white/8">
                    <div className="x-modal-header-copy">
                      <h3 className="text-xl font-semibold text-white">{t("providerServiceDeployPage.parserTitle")}</h3>
                      <p className="mt-1 text-sm text-zinc-500">{t("providerServiceDeployPage.parserDescription")}</p>
                    </div>
                    <button type="button" onClick={closeParser} className="x-modal-close">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="x-modal-body grid gap-5 overflow-y-auto xl:grid-cols-2">
                    <div>
                      <label htmlFor="ai-curl-command" className="mb-1.5 block text-sm font-medium text-zinc-200">{t("providerServiceDeployPage.parserCurlLabel")}</label>
                      <textarea
                        id="ai-curl-command"
                        className="h-[420px] w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-xs text-green-300 outline-none transition focus:border-green-500"
                        value={aiCurl}
                        onChange={(event) => setAICurl(event.target.value)}
                        placeholder={DEFAULT_AI_PARSER_SAMPLE}
                      />
                      {aiCurl.trim() && !aiCurlLooksValid ? (
                        <p className="mt-2 text-xs text-amber-300">{t("providerServiceDeployPage.parserCurlInvalid")}</p>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">{t("providerServiceDeployPage.parserCurlHint")}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="ai-response-json" className="mb-1.5 block text-sm font-medium text-zinc-200">{t("providerServiceDeployPage.parserJsonLabel")}</label>
                      <textarea
                        id="ai-response-json"
                        className="h-[420px] w-full rounded-2xl border border-white/10 bg-[#06080c] px-4 py-3 font-mono text-xs text-blue-300 outline-none transition focus:border-green-500"
                        value={aiResponse}
                        onChange={(event) => setAIResponse(event.target.value)}
                        placeholder={t("providerServiceDeployPage.parserJsonPlaceholder")}
                      />
                      {aiResponse.trim() && !parsedAiResponse ? <p className="mt-2 text-xs text-amber-300">{t("providerServiceDeployPage.parserJsonInvalid")}</p> : <p className="mt-2 text-xs text-zinc-500">{t("providerServiceDeployPage.parserJsonHint")}</p>}
                    </div>
                  </div>
                  <div className="x-modal-footer border-t border-white/8">
                    <button
                      type="button"
                      onClick={autofillAIMagic}
                      disabled={isAiGenerating || !aiCurlLooksValid}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAiGenerating ? t("providerServiceDeployPage.parserGenerating") : t("providerServiceDeployPage.parserGenerate")}
                    </button>
                    <button
                      type="button"
                      onClick={confirmAndInject}
                      disabled={!parsedAiResponse || isAiGenerating}
                      className="inline-flex items-center gap-2 rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      {t("providerServiceDeployPage.parserConfirm")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AuthMask>
  );
}
