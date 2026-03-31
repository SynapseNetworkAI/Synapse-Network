"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CircleHelp,
  Layers3,
  Plus,
  Route,
  Server,
  ShieldCheck,
  Wand2,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";

import AuthMask from "@/components/AuthMask";
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

const FIELD_GUIDES: Record<string, FieldGuideItem> = {
  serviceId: {
    title: "Service ID",
    purpose: "Stable machine identity for discovery, quote and invoke.",
    howToConfigure: "Use lowercase letters, digits, underscore or hyphen. Underscore is supported and should be preserved when intentional.",
    platformUse: "Primary routing key and global uniqueness boundary.",
    example: "svc_invoice_ocr_apac",
  },
  serviceName: {
    title: "Service Name",
    purpose: "Human-readable label in marketplace and provider console.",
    howToConfigure: "Write it like a product name, not an internal class name.",
    platformUse: "Display and search ranking trust signal.",
    example: "SEA Invoice OCR",
  },
  descriptionForModel: {
    title: "Description for Model",
    purpose: "Tell autonomous agents when and why to call this service.",
    howToConfigure: "Describe trigger conditions, not marketing copy.",
    platformUse: "Discovery matching and runtime decision quality.",
  },
  taskCategory: {
    title: "Task Category",
    purpose: "Coarse semantic bucket for routing and discovery.",
    howToConfigure: "Use dotted taxonomy such as ocr.invoice or search.web.",
    platformUse: "Improves search recall and future ranking strategies.",
  },
  runtime: {
    title: "Runtime Contract",
    purpose: "Defines endpoint, timeout and payload boundaries.",
    howToConfigure: "Mirror the real upstream SLA, not wishful numbers.",
    platformUse: "Admission control, forwarding and health evaluation.",
  },
  billing: {
    title: "Billing Contract",
    purpose: "Defines price model and settlement currency.",
    howToConfigure: "Use USDC-native numbers with one fixed per-call price.",
    platformUse: "Settlement and charge ledger alignment.",
  },
  routingTargets: {
    title: "Routing Targets",
    purpose: "Active-active upstream targets behind the service contract.",
    howToConfigure: "Add one or more invoke URLs with weights and optional regions.",
    platformUse: "Weighted failover and health-based routing.",
  },
  ioSchema: {
    title: "IO Schema",
    purpose: "Defines the JSON contract agents will parse against.",
    howToConfigure: "Use strict object schemas with stable keys.",
    platformUse: "Caller understanding and response parsing reliability.",
  },
};

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
    inputSchemaText: "{}",
    outputSchemaText: "{}",
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

const collectIdentityErrors = (draft: ManifestDraft, errors: Record<string, string>): void => {
  const serviceId = draft.identity.serviceId.trim();
  const serviceName = draft.identity.serviceName.trim();
  const manifestVersion = draft.identity.manifestVersion.trim();
  const descriptionForModel = draft.modelUsage.descriptionForModel.trim();

  if (!serviceId) {
    errors.serviceId = "Service ID is required.";
  } else if (!SERVICE_ID_REGEX.test(serviceId)) {
    errors.serviceId = "Service ID must match ^[a-z0-9_-]{3,64}$.";
  }
  if (!serviceName) {
    errors.serviceName = "Service Name is required.";
  } else if (serviceName.length < SERVICE_NAME_MIN || serviceName.length > SERVICE_NAME_MAX) {
    errors.serviceName = `Service Name must be ${SERVICE_NAME_MIN}-${SERVICE_NAME_MAX} chars.`;
  }
  if (!manifestVersion || !/^\d+\.\d+\.\d+$/.test(manifestVersion)) {
    errors.manifestVersion = "Service Version must use semver, for example 1.0.0.";
  }
  if (!descriptionForModel) {
    errors.descriptionForModel = "Description for Model is required.";
  } else if (descriptionForModel.length < DESCRIPTION_MIN || descriptionForModel.length > DESCRIPTION_MAX) {
    errors.descriptionForModel = `Description for Model must be ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} chars.`;
  }
};

const collectSchemaErrors = (
  inputSchemaValid: boolean,
  outputSchemaValid: boolean,
  examplesValid: boolean,
  errors: Record<string, string>,
): void => {
  if (!inputSchemaValid) errors.inputSchema = "Input Schema must be valid JSON object.";
  if (!outputSchemaValid) errors.outputSchema = "Output Schema must be valid JSON object.";
  if (!examplesValid) errors.examples = "Examples must be valid JSON array.";
};

const collectRuntimeErrors = (
  draft: ManifestDraft,
  normalizedTargets: Array<{ url: string; region?: string; weight: number }>,
  errors: Record<string, string>,
): void => {
  const basePriceUsdc = Number(draft.billing.basePriceUsdc);

  if (!Number.isFinite(basePriceUsdc) || basePriceUsdc < 0) {
    errors.basePriceUsdc = "Base Price USDC must be a non-negative number.";
  }
  if (!isHttpUrl(draft.runtime.endpointUrl.trim())) {
    errors.endpointUrl = "Endpoint URL must be a valid http(s) URL.";
  }
  if (draft.runtime.timeoutMs < SERVICE_CONSTRAINT_LIMITS.timeoutMs.min || draft.runtime.timeoutMs > SERVICE_CONSTRAINT_LIMITS.timeoutMs.max) {
    errors.timeoutMs = `Timeout must be in [${SERVICE_CONSTRAINT_LIMITS.timeoutMs.min}, ${SERVICE_CONSTRAINT_LIMITS.timeoutMs.max}] ms.`;
  }
  if (draft.runtime.maxRequestBytes < SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min || draft.runtime.maxRequestBytes > SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max) {
    errors.maxRequestBytes = `Max Request Bytes must be in [${SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min}, ${SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max}].`;
  }
  if (draft.runtime.maxResponseBytes < SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min || draft.runtime.maxResponseBytes > SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max) {
    errors.maxResponseBytes = `Max Response Bytes must be in [${SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min}, ${SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max}].`;
  }
  if (!normalizeHealthPath(draft.gatewayExtensions.healthCheck.path).startsWith("/")) {
    errors.healthPath = "Health Check Path must start with /.";
  }
  if (normalizedTargets.length === 0) {
    errors.routingTargets = "At least one valid routing target is required.";
  }
  if (draft.gatewayExtensions.routingTargets.some((target) => target.url.trim() && (target.weight < WEIGHT_MIN || target.weight > WEIGHT_MAX))) {
    errors.routingTargets = `Target weight must be in [${WEIGHT_MIN}, ${WEIGHT_MAX}].`;
  }
  if (draft.gatewayExtensions.rateLimitPolicy.maxQps < SERVICE_CONSTRAINT_LIMITS.maxQps.min || draft.gatewayExtensions.rateLimitPolicy.maxQps > SERVICE_CONSTRAINT_LIMITS.maxQps.max) {
    errors.maxQps = `Max QPS must be in [${SERVICE_CONSTRAINT_LIMITS.maxQps.min}, ${SERVICE_CONSTRAINT_LIMITS.maxQps.max}].`;
  }
};

const validateDraft = (
  draft: ManifestDraft,
  inputSchemaValid: boolean,
  outputSchemaValid: boolean,
  examplesValid: boolean,
  normalizedTargets: Array<{ url: string; region?: string; weight: number }>,
): Record<string, string> => {
  const errors: Record<string, string> = {};
  collectIdentityErrors(draft, errors);
  collectSchemaErrors(inputSchemaValid, outputSchemaValid, examplesValid, errors);
  collectRuntimeErrors(draft, normalizedTargets, errors);

  return errors;
};

function FieldGuideHint({ item }: Readonly<{ item?: FieldGuideItem }>) {
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
        <p className="mt-2 text-gray-400">Configure: {item.howToConfigure}</p>
        <p className="mt-1 text-gray-400">Platform: {item.platformUse}</p>
        {item.example ? <p className="mt-1 text-green-300">Example: {item.example}</p> : null}
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
          Add
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
            className="rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-green-500"
            placeholder="https://provider.example.com/invoke"
            value={target.url}
            onChange={(event) => updateTarget(index, "url", event.target.value)}
          />
          <input
            type="text"
            className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition focus:border-green-500"
            placeholder="ap-southeast-1"
            value={target.region}
            onChange={(event) => updateTarget(index, "region", event.target.value)}
          />
          <input
            type="number"
            className="rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-green-500"
            value={target.weight}
            onChange={(event) => updateTarget(index, "weight", Number.parseInt(event.target.value, 10) || 0)}
          />
          <button
            type="button"
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
        Add Routing Target
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

  const [draft, setDraft] = useState<ManifestDraft>(createDefaultDraft);
  const [hasDraft, setHasDraft] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
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
      setHasDraft(false);
      toast.success("Service definition draft restored.");
    } catch {
      toast.error("Stored draft is corrupted. Start from a clean service definition.");
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
    () => validateDraft(draft, inputSchema.valid, outputSchema.valid, examples.valid, normalizedTargets),
    [draft, inputSchema.valid, outputSchema.valid, examples.valid, normalizedTargets],
  );

  const readinessChecks = useMemo(
    () => [
      { label: "Identity", ok: Boolean(draft.identity.serviceId.trim() && draft.identity.serviceName.trim()) },
      { label: "Model Contract", ok: Boolean(draft.modelUsage.descriptionForModel.trim()) },
      { label: "Schema", ok: inputSchema.valid && outputSchema.valid },
      { label: "Billing", ok: Boolean(draft.billing.basePriceUsdc.trim()) },
      { label: "Runtime", ok: isHttpUrl(draft.runtime.endpointUrl.trim()) },
      { label: "Gateway Extensions", ok: normalizedTargets.length > 0 },
    ],
    [draft, inputSchema.valid, outputSchema.valid, normalizedTargets.length],
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

  const completedChecks = readinessChecks.filter((item) => item.ok).length;
  const readinessPercent = Math.round((completedChecks / readinessChecks.length) * 100);
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
        throw new Error("Raw cURL Command must start with curl and include a valid http(s) URL.");
      }
      if (!address) {
        throw new Error("Wallet not connected. Please connect wallet and sign in first.");
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
        throw new Error(normalizeAuthApiError(raw || "Failed to parse cURL", response.status));
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
        throw new Error(payload.detail || "Unknown parser error.");
      }

      const parsed = payload.data ?? payload.parsed ?? payload.manifest ?? payload.result;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Parser did not return a valid service definition object.");
      }

      setAIResponse(JSON.stringify(parsed, null, 2));
      toast.success("AI service definition draft generated. Review and confirm override.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse cURL.";
      toast.error(message);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const confirmAndInject = () => {
    if (!parsedAiResponse) {
      toast.error("Expected / Generated Service Definition JSON must be valid JSON object.");
      return;
    }

    setDraft((current) => normalizeParsedManifest(current, parsedAiResponse));
    closeParser();
    toast.success("Parsed service definition data injected into the form.");
  };

  const submitDeploy = async () => {
    if (nextBlockingIssue) {
      toast.error(nextBlockingIssue);
      return;
    }
    if (!address) {
      toast.error("Wallet not connected. Please connect wallet and sign in first.");
      return;
    }

    setIsDeploying(true);
    try {
      await createServiceRegistry(gatewayPayloadPreview, address);
      localStorage.removeItem(STORAGE_KEY);
      toast.success("API service submitted.");
      router.replace("/provider/services");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create service.";
      toast.error(message);
    } finally {
      setIsDeploying(false);
    }
  };

  let deploymentLabel = "CREATE API SERVICE";
  if (isDeploying) {
    deploymentLabel = "CREATING SERVICE...";
  } else if (nextBlockingIssue) {
    deploymentLabel = "FIX CONTRACT VALIDATION";
  }

  return (
    <AuthMask
      allowChallengeAuthorize={false}
      sessionHelpText="This page is session-only. Please complete wallet sign-in from My Services, then return to create a service."
      sessionRecoveryHref="/provider/services"
      sessionRecoveryLabel="Go to API Services"
    >
      <div className="min-h-[calc(100vh-80px)] bg-[#050505]">
        <div className="mx-auto grid max-w-[1680px] gap-6 px-4 py-6 lg:grid-cols-[1.15fr_0.95fr] xl:px-6">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,197,94,0.12),transparent_28%),linear-gradient(180deg,#0c0f14,#07090d)] p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <Link href="/provider/services" className="inline-flex items-center gap-2 text-sm text-zinc-500 transition hover:text-green-300">
                    <ArrowLeft className="h-4 w-4" />
                    Back to API Services
                  </Link>
                  <div className="mt-5 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-green-500/20 bg-green-500/10 text-green-300">
                      <Server className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">Provider Control Plane</p>
                      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Create API Service</h1>
                    </div>
                  </div>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-400">
                    This page now follows the new service definition standard and SQL target model. You define the agent-facing contract,
                    runtime boundary and gateway extensions here. The right side shows both the standard service definition and the current gateway
                    submission mapping, so there is no contract theater.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={closeDeployPage}
                    aria-label="Close create API service page"
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
                      Restore Draft
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={openParser}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    <Wand2 className="h-4 w-4" />
                    AI Definition Assist
                  </button>
                </div>
              </div>
            </div>

            <SectionCard
              index="01"
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Identity Layer"
              summary="Define the immutable machine identity and the human-facing contract header."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label="Service ID"
                  value={draft.identity.serviceId}
                  onChange={(value) => updateIdentity("serviceId", normalizeServiceId(value))}
                  placeholder="svc_invoice_ocr_apac"
                  error={fieldErrors.serviceId}
                  hint="Globally unique service contract key. Letters, digits, underscore and hyphen are allowed."
                  guide={FIELD_GUIDES.serviceId}
                  mono
                />
                <TextField
                  label="Service Name"
                  value={draft.identity.serviceName}
                  onChange={(value) => updateIdentity("serviceName", value)}
                  placeholder="SEA Invoice OCR"
                  error={fieldErrors.serviceName}
                  hint="Human-readable product name shown in provider console and marketplace."
                  guide={FIELD_GUIDES.serviceName}
                />
                <TextField
                  label="Service Slug"
                  value={draft.identity.serviceSlug}
                  onChange={(value) => updateIdentity("serviceSlug", slugifyValue(value))}
                  placeholder="sea-invoice-ocr"
                  hint="Optional marketing-safe slug. If omitted, it is derived from Service Name."
                  mono
                />
                <TextField
                  label="Service Version"
                  value={draft.identity.manifestVersion}
                  onChange={(value) => updateIdentity("manifestVersion", value)}
                  placeholder="1.0.0"
                  error={fieldErrors.manifestVersion}
                  hint="Semver for contract evolution."
                  mono
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-black/60 p-4 text-sm text-zinc-400">
                  <p className="font-medium text-white">Initial Service State</p>
                  <p className="mt-2 leading-6">
                    New services are created as draft. Runtime availability and serving status are determined by gateway health checks after registration.
                  </p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/60 p-4 text-sm text-zinc-400">
                  <p className="font-medium text-white">Owner / Provider Binding</p>
                  <p className="mt-2 leading-6">
                    Provider profile and payout account are bound by the platform control plane, not by this public service contract.
                    That is why the page collects service identity, not settlement identity.
                  </p>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              index="02"
              icon={<Layers3 className="h-5 w-5" />}
              title="Agent Contract"
              summary="Tell the agent what this service does, when to call it, and what schemas it should trust."
            >
              <TextField
                label="Description for Model"
                value={draft.modelUsage.descriptionForModel}
                onChange={(value) => updateModelUsage("descriptionForModel", value)}
                placeholder="Extract structured invoice fields from Southeast Asia invoice images."
                error={fieldErrors.descriptionForModel}
                hint="Required. This is discovery and decision text for autonomous agents."
                guide={FIELD_GUIDES.descriptionForModel}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label="Task Category"
                  value={draft.modelUsage.taskCategory}
                  onChange={(value) => updateModelUsage("taskCategory", value)}
                  placeholder="ocr.invoice"
                  hint="Optional but strongly recommended semantic bucket."
                  guide={FIELD_GUIDES.taskCategory}
                  mono
                />
                <div className="rounded-2xl border border-white/8 bg-black/60 p-4 text-sm text-zinc-400">
                  <p className="font-medium text-white">Agent-facing Rule</p>
                  <p className="mt-2 leading-6">
                    This is not marketing copy. If the text does not help an agent decide when to call, it does not belong here.
                  </p>
                </div>
              </div>
              <div className="grid gap-5 xl:grid-cols-3">
                <TagEditor
                  label="Capabilities"
                  values={draft.modelUsage.capabilities}
                  onChange={(next) => updateModelUsage("capabilities", next)}
                  placeholder="merchant_extraction"
                  hint="Atomic abilities exposed by the service."
                />
                <TagEditor
                  label="Limitations"
                  values={draft.modelUsage.limitations}
                  onChange={(next) => updateModelUsage("limitations", next)}
                  placeholder="not_for_handwritten_receipts"
                  hint="Known boundaries to keep invocation safe."
                />
                <div>
                  <label htmlFor="supported-languages" className="mb-1.5 block text-sm font-medium text-zinc-200">Supported Languages</label>
                  <select
                    id="supported-languages"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none transition focus:border-green-500"
                    value={normalizeSupportedLanguages(draft.modelUsage.supportedLanguages)[0]}
                    onChange={(event) => updateModelUsage("supportedLanguages", [event.target.value])}
                  >
                    <option value="en">EN</option>
                    <option value="cn">CN</option>
                  </select>
                  <FieldNote hint="V1 supports a single contract language selection: EN or CN." />
                </div>
              </div>
              <JsonEditor
                label="Examples JSON Array"
                value={draft.modelUsage.examplesText}
                onChange={(value) => updateModelUsage("examplesText", value)}
                error={fieldErrors.examples}
                hint="Use an array of objects with input/output pairs."
              />
              <div className="grid gap-5 xl:grid-cols-2">
                <JsonEditor
                  label="Input Schema"
                  value={draft.ioSchema.inputSchemaText}
                  onChange={(value) => updateIoSchema("inputSchemaText", value)}
                  error={fieldErrors.inputSchema}
                  hint="Must be a valid JSON object."
                />
                <JsonEditor
                  label="Output Schema"
                  value={draft.ioSchema.outputSchemaText}
                  onChange={(value) => updateIoSchema("outputSchemaText", value)}
                  error={fieldErrors.outputSchema}
                  hint="Must be a valid JSON object."
                />
              </div>
            </SectionCard>

            <SectionCard
              index="03"
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Billing Contract"
              summary="Define the fixed per-call commercial contract the gateway can settle in V1."
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-200">
                    <span>Price Model</span>
                    <FieldGuideHint item={FIELD_GUIDES.billing} />
                  </label>
                  <select
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-zinc-400 outline-none"
                    value={DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel}
                    disabled
                  >
                    <option value="fixed">fixed</option>
                  </select>
                  <FieldNote hint="V1 only supports fixed pricing: one base price per invocation." />
                </div>
                <TextField
                  label="Base Price USDC"
                  value={draft.billing.basePriceUsdc}
                  onChange={(value) => updateBilling("basePriceUsdc", value)}
                  placeholder="0.008"
                  error={fieldErrors.basePriceUsdc}
                  hint="Use decimal USDC, not fiat approximations."
                  mono
                />
                <TextField
                  label="Settlement Currency"
                  value={draft.billing.settlementCurrency}
                  onChange={(value) => updateBilling("settlementCurrency", value.toUpperCase())}
                  placeholder={DEFAULT_SERVICE_SETTLEMENT_CURRENCY}
                  hint="Current system is USDC-native."
                  mono
                />
                <div className="rounded-2xl border border-white/8 bg-black/60 p-4 text-sm text-zinc-400">
                  <p className="font-medium text-white">Billing Rule</p>
                  <p className="mt-2 leading-6">
                    V1 only supports per-call billing. One invoke corresponds to one base-price charge.
                  </p>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              index="04"
              icon={<Route className="h-5 w-5" />}
              title="Runtime Boundary"
              summary="Declare the upstream endpoint and execution boundaries the gateway must respect."
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <TextField
                  label="Primary Endpoint URL"
                  value={draft.runtime.endpointUrl}
                  onChange={(value) => updateRuntime("endpointUrl", value)}
                  placeholder="https://provider.example.com/invoke"
                  error={fieldErrors.endpointUrl}
                  hint="This is the canonical invoke URL if no routing targets are defined."
                  guide={FIELD_GUIDES.runtime}
                  mono
                />
                <TextField
                  label="Auth Mode"
                  value={draft.runtime.authMode}
                  onChange={(value) => updateRuntime("authMode", value)}
                  placeholder={DEFAULT_SERVICE_AUTH_MODE}
                  hint="Defines how the gateway authenticates to your upstream. gateway_forward means Synapse forwards the request using platform-managed credentials and headers."
                  mono
                />
                <NumberField
                  label="Timeout (ms)"
                  value={draft.runtime.timeoutMs}
                  onChange={(value) => updateRuntime("timeoutMs", value)}
                  error={fieldErrors.timeoutMs}
                  hint={`Allowed range ${SERVICE_CONSTRAINT_LIMITS.timeoutMs.min}-${SERVICE_CONSTRAINT_LIMITS.timeoutMs.max}.`}
                />
                <NumberField
                  label="Max Request Bytes"
                  value={draft.runtime.maxRequestBytes}
                  onChange={(value) => updateRuntime("maxRequestBytes", value)}
                  error={fieldErrors.maxRequestBytes}
                  hint={`Allowed range ${SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.min}-${SERVICE_CONSTRAINT_LIMITS.maxRequestBytes.max}.`}
                />
                <NumberField
                  label="Max Response Bytes"
                  value={draft.runtime.maxResponseBytes}
                  onChange={(value) => updateRuntime("maxResponseBytes", value)}
                  error={fieldErrors.maxResponseBytes}
                  hint={`Allowed range ${SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.min}-${SERVICE_CONSTRAINT_LIMITS.maxResponseBytes.max}.`}
                />
              </div>
            </SectionCard>

            <SectionCard
              index="05"
              icon={<Route className="h-5 w-5" />}
              title="Gateway Extensions"
              summary="Internal execution policy for health checks, multi-target routing and forwarding. Platform-managed tracing and metering defaults are applied automatically."
            >
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <p className="mb-1.5 block text-sm font-medium text-zinc-200">Health Method</p>
                  <div className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-zinc-400">
                    {DEFAULT_SERVICE_HEALTH_METHOD}
                  </div>
                  <FieldNote hint="Platform probes health with a fixed GET request in V1." />
                </div>
                <TextField
                  label="Health Path"
                  value={draft.gatewayExtensions.healthCheck.path}
                  onChange={(value) => updateHealthCheck("path", value)}
                  placeholder="/health"
                  error={fieldErrors.healthPath}
                  hint="Gateway composes origin + this path for probes."
                />
                <div>
                  <p className="mb-1.5 block text-sm font-medium text-zinc-200">Health Interval (sec)</p>
                  <div className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-zinc-400">
                    {DEFAULT_SERVICE_HEALTH_INTERVAL_SEC}
                  </div>
                  <FieldNote hint="Platform probes every 10 seconds in V1." />
                </div>
                <NumberField
                  label="Health Timeout (ms)"
                  value={draft.gatewayExtensions.healthCheck.timeoutMs}
                  onChange={(value) => updateHealthCheck("timeoutMs", value)}
                  hint="Probe timeout, usually lower than invoke timeout."
                />
              </div>
              <div>
                <p className="mb-1.5 block text-sm font-medium text-zinc-200">Health Success Codes</p>
                <div className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-zinc-400">
                  {DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT}
                </div>
                <FieldNote hint="V1 treats HTTP 200 as the health success signal." />
              </div>
              <div>
                <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <span>Routing Targets</span>
                  <FieldGuideHint item={FIELD_GUIDES.routingTargets} />
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
                <FieldNote error={fieldErrors.routingTargets} hint="Each target should be an invoke URL. Weight maps to traffic share." />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <p className="mb-1.5 block text-sm font-medium text-zinc-200">Request ID Header</p>
                  <div className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-sm text-zinc-400">
                    {DEFAULT_SERVICE_REQUEST_ID_HEADER}
                  </div>
                  <FieldNote hint="Platform-managed trace header. V1 always injects this value." />
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/60 px-4 py-3">
                  <p className="text-sm font-medium text-white">Forwarding Rule</p>
                  <p className="mt-1 text-xs leading-6 text-zinc-500">
                    V1 does not expose pass-through header configuration. Synapse injects only platform-managed headers.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <NumberField
                  label="Rate Limit QPS"
                  value={draft.gatewayExtensions.rateLimitPolicy.maxQps}
                  onChange={updateRateLimitPolicy}
                  error={fieldErrors.maxQps}
                  hint={`Gateway v1 admission cap ${SERVICE_CONSTRAINT_LIMITS.maxQps.min}-${SERVICE_CONSTRAINT_LIMITS.maxQps.max}.`}
                />
                <div className="rounded-2xl border border-white/8 bg-black/60 px-4 py-3">
                  <p className="text-sm font-medium text-white">Platform Defaults</p>
                  <p className="mt-1 text-xs leading-6 text-zinc-500">
                    Bill-on-error, request-id enforcement, response-size metering and billable status classes are controlled by the platform in V1.
                  </p>
                </div>
              </div>
            </SectionCard>

            {showAIModal ? (
              <div className="x-dialog-shell x-modal-overlay">
                <button
                  type="button"
                  aria-label="Close AI parser"
                  onClick={closeParser}
                  className="absolute inset-0"
                />
                <div className="x-modal-flat x-modal-surface relative z-10 flex max-h-[92vh] max-w-6xl flex-col border border-green-900/40 shadow-[0_0_50px_rgba(34,197,94,0.12)]">
                  <div className="x-modal-header border-b border-white/8">
                    <div className="x-modal-header-copy">
                      <h3 className="text-xl font-semibold text-white">AI Service Definition Parser</h3>
                      <p className="mt-1 text-sm text-zinc-500">Paste a complete API example block: raw cURL command plus the returned JSON result. The parser will infer the current V1 service definition fields and fill the form.</p>
                    </div>
                    <button type="button" onClick={closeParser} className="x-modal-close">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="x-modal-body grid gap-5 overflow-y-auto xl:grid-cols-2">
                    <div>
                      <label htmlFor="ai-curl-command" className="mb-1.5 block text-sm font-medium text-zinc-200">Raw cURL Command + Result</label>
                      <textarea
                        id="ai-curl-command"
                        className="h-[420px] w-full rounded-2xl border border-white/10 bg-black px-4 py-3 font-mono text-xs text-green-300 outline-none transition focus:border-green-500"
                        value={aiCurl}
                        onChange={(event) => setAICurl(event.target.value)}
                        placeholder={DEFAULT_AI_PARSER_SAMPLE}
                      />
                      {aiCurl.trim() && !aiCurlLooksValid ? (
                        <p className="mt-2 text-xs text-amber-300">Enter a valid example block that starts with curl, contains a full http(s) URL, and can optionally include the returned JSON result after the command.</p>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500">Natural language notes are not accepted here. Paste the actual cURL request and, if available, the real JSON response right below it.</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="ai-response-json" className="mb-1.5 block text-sm font-medium text-zinc-200">Expected / Generated Service Definition JSON</label>
                      <textarea
                        id="ai-response-json"
                        className="h-[420px] w-full rounded-2xl border border-white/10 bg-[#06080c] px-4 py-3 font-mono text-xs text-blue-300 outline-none transition focus:border-green-500"
                        value={aiResponse}
                        onChange={(event) => setAIResponse(event.target.value)}
                        placeholder='{"service_id":"svc_invoice_ocr_apac"}'
                      />
                      {aiResponse.trim() && !parsedAiResponse ? <p className="mt-2 text-xs text-amber-300">Generated service definition must be a valid JSON object.</p> : <p className="mt-2 text-xs text-zinc-500">You can manually refine the service definition JSON before applying the override.</p>}
                    </div>
                  </div>
                  <div className="x-modal-footer border-t border-white/8">
                    <button
                      type="button"
                      onClick={autofillAIMagic}
                      disabled={isAiGenerating || !aiCurlLooksValid}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAiGenerating ? "Generating..." : "Generate Definition JSON"}
                    </button>
                    <button
                      type="button"
                      onClick={confirmAndInject}
                      disabled={!parsedAiResponse || isAiGenerating}
                      className="inline-flex items-center gap-2 rounded-2xl bg-green-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      Confirm Override
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <div className="sticky top-6 space-y-6">
              <div className="rounded-[28px] border border-white/8 bg-[#0b0d12] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Deployment Readiness</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">Contract Assembly</h2>
                  </div>
                  <p className={`text-sm font-semibold ${nextBlockingIssue ? "text-amber-300" : "text-green-300"}`}>{readinessPercent}%</p>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                  <div className={`h-full ${nextBlockingIssue ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${readinessPercent}%` }} />
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {readinessChecks.map((item) => (
                    <div key={item.label} className={`rounded-2xl border px-3 py-2 text-xs ${item.ok ? "border-green-500/20 bg-green-500/10 text-green-200" : "border-white/8 bg-black/50 text-zinc-500"}`}>
                      {item.ok ? "Ready" : "Pending"} · {item.label}
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/8 bg-black/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Service ID</p>
                    <p className="mt-2 break-all font-mono text-sm text-green-300">{draft.identity.serviceId || "unset"}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Routing Targets</p>
                    <p className="mt-2 text-sm text-white">{normalizedTargets.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Price</p>
                    <p className="mt-2 text-sm text-white">{draft.billing.basePriceUsdc || "0"} {draft.billing.settlementCurrency}</p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Service State</p>
                    <p className="mt-2 text-sm text-white">{DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.status}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-white/8 bg-black/50 p-4 text-sm text-zinc-400">
                  <p className="font-medium text-white">Current Gateway Reality</p>
                  <p className="mt-2 leading-6">
                      V1 only collects the fields the current gateway and control plane can actually honor. New services land as draft, then
                      gateway health checks determine runtime serving status. Streaming, async callback, quality analytics and metering edge rules
                      remain platform-managed, so this page stays focused on identity, model usage, schema, billing, runtime, routing and health checks.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={submitDeploy}
                  disabled={isDeploying || Boolean(nextBlockingIssue)}
                  className="mt-5 flex w-full items-center justify-center rounded-2xl bg-green-500 px-5 py-4 text-sm font-semibold text-black transition hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deploymentLabel}
                </button>
                <p className={`mt-3 text-center text-xs ${nextBlockingIssue ? "text-amber-300" : "text-green-300"}`}>
                  {nextBlockingIssue || "Ready. Core gateway submission contract is consistent with the current backend."}
                </p>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-[#0b0d12] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Agent-facing Contract</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">Standard Service Definition JSON</h2>
                  </div>
                </div>
                <pre className="mt-4 max-h-[380px] overflow-auto rounded-2xl border border-green-500/10 bg-black/70 p-4 font-mono text-xs leading-6 text-green-300">
                  {JSON.stringify(standardManifest, null, 2)}
                </pre>
              </div>

              <div className="rounded-[28px] border border-white/8 bg-[#0b0d12] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Gateway Submission</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">Current Gateway Payload</h2>
                  </div>
                </div>
                <pre className="mt-4 max-h-[380px] overflow-auto rounded-2xl border border-white/8 bg-black/70 p-4 font-mono text-xs leading-6 text-sky-300">
                  {JSON.stringify(gatewayPayloadPreview, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthMask>
  );
}
