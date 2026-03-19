import type { ServiceRegistryPayload, ServiceRegistryRecord } from "@/utils/serviceApi";
import { nowDateTimeString } from "@/utils/time";
import { extractPricingAmount } from "@/utils/pricing";

export const DEFAULT_SERVICE_HEALTH_PATH = "/health";
export const DEFAULT_SERVICE_HEALTH_METHOD = "GET" as const;
export const DEFAULT_SERVICE_HEALTH_INTERVAL_SEC = 10;
export const DEFAULT_SERVICE_HEALTH_TIMEOUT_MS = 3000;
export const DEFAULT_SERVICE_HEALTH_SUCCESS_CODES = [200];
export const DEFAULT_SERVICE_HEALTH_SUCCESS_CODES_TEXT = "200";
export const DEFAULT_SERVICE_HEALTHY_THRESHOLD = 2;
export const DEFAULT_SERVICE_UNHEALTHY_THRESHOLD = 3;
export const DEFAULT_SERVICE_AUTH_MODE = "gateway_forward";
export const DEFAULT_SERVICE_AUTH_TYPE = "service_key";
export const DEFAULT_SERVICE_AUTH_HEADER_NAME = "X-Credential";
export const DEFAULT_SERVICE_REQUEST_ID_HEADER = "X-Synapse-Request-Id";
export const DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS = 2;
export const DEFAULT_SERVICE_RETRY_BACKOFF_MS = 200;
export const DEFAULT_SERVICE_RETRY_ON_STATUS = [429, 500, 502, 503, 504] as const;
export const DEFAULT_SERVICE_RETRY_ON_STATUS_TEXT = DEFAULT_SERVICE_RETRY_ON_STATUS.join(",");
export const DEFAULT_SERVICE_BILLING_UNIT = "per_call" as const;
export const DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES: Array<2 | 4 | 5> = [2];
export const DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES_TEXT = DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES.join(",");
export const DEFAULT_SERVICE_SETTLEMENT_CURRENCY = "USDC";
export const DEFAULT_SERVICE_REQUEST_CONTENT_TYPE = "application/json";
export const DEFAULT_SERVICE_INVOKE_METHOD = "POST";
export const DEFAULT_PROVIDER_SERVICE_ROLE = "Provider";
export const DEFAULT_PROVIDER_SERVICE_REGISTRY_STATUS = "draft" as const;
export const DEFAULT_PROVIDER_SERVICE_PRICE_MODEL = "fixed" as const;
export const DEFAULT_PROVIDER_SERVICE_IS_ACTIVE = false;
export const DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET = {
  role: DEFAULT_PROVIDER_SERVICE_ROLE,
  status: DEFAULT_PROVIDER_SERVICE_REGISTRY_STATUS,
  isActive: DEFAULT_PROVIDER_SERVICE_IS_ACTIVE,
  priceModel: DEFAULT_PROVIDER_SERVICE_PRICE_MODEL,
  settlementCurrency: DEFAULT_SERVICE_SETTLEMENT_CURRENCY,
} as const;

export type ServiceDeployRoutingTarget = {
  url: string;
  region?: string;
  weight: number;
};

export type ServiceDeployDraftInput = {
  identity: {
    serviceId: string;
    serviceName: string;
    serviceSlug: string;
    manifestVersion: string;
  };
  modelUsage: {
    descriptionForModel: string;
    taskCategory: string;
    capabilities: string[];
    limitations: string[];
    supportedLanguages: string[];
  };
  billing: {
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
  gatewayExtensions: {
    healthCheck: {
      path: string;
      timeoutMs: number;
    };
    rateLimitPolicy: {
      maxQps: number;
    };
  };
};

export type ProviderDeployStandardManifest = {
  service_id: string;
  service_name: string;
  service_slug?: string;
  manifest_version: string;
  model_usage: {
    description_for_model: string;
    task_category?: string;
    capabilities: string[];
    limitations: string[];
    supported_languages: string[];
    examples: unknown[];
  };
  io_schema: {
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
  };
  billing: {
    price_model: typeof DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel;
    base_price_usdc: string;
    settlement_currency: string;
  };
  runtime: {
    endpoint_url: string;
    auth_mode: string;
    timeout_ms: number;
    max_request_bytes: number;
    max_response_bytes: number;
  };
  gateway_extensions: {
    health_check: {
      method: typeof DEFAULT_SERVICE_HEALTH_METHOD;
      path: string;
      interval_sec: number;
      timeout_ms: number;
      success_codes: number[];
    };
    routing_targets: ServiceDeployRoutingTarget[];
    forwarding_policy: {
      request_id_header: typeof DEFAULT_SERVICE_REQUEST_ID_HEADER;
    };
    rate_limit_policy: {
      max_qps: number;
    };
  };
};

type ProviderDeployBuilderInput = {
  draft: ServiceDeployDraftInput;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples: unknown[];
  successCodes: number[];
  normalizedTargets: ServiceDeployRoutingTarget[];
};

type ProviderDeployGatewayPayloadInput = ProviderDeployBuilderInput & {
  address?: string;
};

function dedupeTextItems(values: string[]): string[] {
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
}

function slugifyServiceValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-_]+|[-_]+$/g, "");
}

function normalizeDeployHealthPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SERVICE_HEALTH_PATH;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeDeploySupportedLanguages(values: string[]): string[] {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is "en" | "cn" => value === "en" || value === "cn");

  if (normalized.length === 0) {
    return ["en"];
  }

  return [normalized[0]];
}

export function buildProviderDeployStandardManifest(
  input: ProviderDeployBuilderInput,
): ProviderDeployStandardManifest {
  const { draft, inputSchema, outputSchema, examples, successCodes, normalizedTargets } = input;
  const derivedServiceSlug = draft.identity.serviceSlug.trim()
    || slugifyServiceValue(draft.identity.serviceName || draft.identity.serviceId);

  return {
    service_id: draft.identity.serviceId.trim(),
    service_name: draft.identity.serviceName.trim(),
    service_slug: derivedServiceSlug || undefined,
    manifest_version: draft.identity.manifestVersion.trim(),
    model_usage: {
      description_for_model: draft.modelUsage.descriptionForModel.trim(),
      task_category: draft.modelUsage.taskCategory.trim() || undefined,
      capabilities: dedupeTextItems(draft.modelUsage.capabilities),
      limitations: dedupeTextItems(draft.modelUsage.limitations),
      supported_languages: normalizeDeploySupportedLanguages(draft.modelUsage.supportedLanguages),
      examples,
    },
    io_schema: {
      input_schema: inputSchema,
      output_schema: outputSchema,
    },
    billing: {
      price_model: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.priceModel,
      base_price_usdc: draft.billing.basePriceUsdc.trim(),
      settlement_currency: draft.billing.settlementCurrency.trim() || DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.settlementCurrency,
    },
    runtime: {
      endpoint_url: draft.runtime.endpointUrl.trim(),
      auth_mode: draft.runtime.authMode.trim() || DEFAULT_SERVICE_AUTH_MODE,
      timeout_ms: draft.runtime.timeoutMs,
      max_request_bytes: draft.runtime.maxRequestBytes,
      max_response_bytes: draft.runtime.maxResponseBytes,
    },
    gateway_extensions: {
      health_check: {
        method: DEFAULT_SERVICE_HEALTH_METHOD,
        path: normalizeDeployHealthPath(draft.gatewayExtensions.healthCheck.path),
        interval_sec: DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
        timeout_ms: draft.gatewayExtensions.healthCheck.timeoutMs,
        success_codes: successCodes,
      },
      routing_targets: normalizedTargets,
      forwarding_policy: {
        request_id_header: DEFAULT_SERVICE_REQUEST_ID_HEADER,
      },
      rate_limit_policy: {
        max_qps: draft.gatewayExtensions.rateLimitPolicy.maxQps,
      },
    },
  };
}

export function buildProviderDeployGatewayPayloadPreview(
  input: ProviderDeployGatewayPayloadInput,
): ServiceRegistryPayload {
  const { draft, inputSchema, outputSchema, examples, successCodes, normalizedTargets, address } = input;
  const serviceId = draft.identity.serviceId.trim();
  const description = draft.modelUsage.descriptionForModel.trim();
  const combinedTags = dedupeTextItems([
    draft.identity.serviceSlug.trim(),
    draft.modelUsage.taskCategory.trim(),
    ...draft.modelUsage.capabilities,
  ]);

  return {
    serviceId,
    serviceName: draft.identity.serviceName.trim(),
    createdAt: nowDateTimeString(),
    updatedAt: nowDateTimeString(),
    role: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.role,
    address: address || "",
    pricing: {
      currency: draft.billing.settlementCurrency.trim() || DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.settlementCurrency,
      amount: draft.billing.basePriceUsdc.trim() || "0",
    },
    isActive: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.isActive,
    status: DEFAULT_PROVIDER_SERVICE_DEPLOY_PRESET.status,
    summary: description,
    tags: combinedTags,
    auth: {
      type: draft.runtime.authMode.trim() || DEFAULT_SERVICE_AUTH_MODE,
      headerName: DEFAULT_SERVICE_AUTH_HEADER_NAME,
    },
    healthCheck: {
      path: normalizeDeployHealthPath(draft.gatewayExtensions.healthCheck.path),
      method: DEFAULT_SERVICE_HEALTH_METHOD,
      intervalSec: DEFAULT_SERVICE_HEALTH_INTERVAL_SEC,
      timeoutMs: draft.gatewayExtensions.healthCheck.timeoutMs,
      successCodes,
      healthyThreshold: DEFAULT_SERVICE_HEALTHY_THRESHOLD,
      unhealthyThreshold: DEFAULT_SERVICE_UNHEALTHY_THRESHOLD,
    },
    constraints: {
      timeoutMs: draft.runtime.timeoutMs,
      maxRequestBytes: draft.runtime.maxRequestBytes,
      maxResponseBytes: draft.runtime.maxResponseBytes,
      maxQps: draft.gatewayExtensions.rateLimitPolicy.maxQps,
    },
    forwarding: {
      requestIdHeader: DEFAULT_SERVICE_REQUEST_ID_HEADER,
      injectHeaders: {
        "X-Synapse-Service-Id": serviceId,
      },
      retryPolicy: {
        maxAttempts: DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS,
        backoffMs: DEFAULT_SERVICE_RETRY_BACKOFF_MS,
        retryOnStatus: [...DEFAULT_SERVICE_RETRY_ON_STATUS],
      },
    },
    metering: {
      billingUnit: DEFAULT_SERVICE_BILLING_UNIT,
      billOnError: false,
      billableStatusClasses: DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES,
      requestIdRequired: true,
      responseSizeMetering: true,
    },
    invoke: {
      method: DEFAULT_SERVICE_INVOKE_METHOD,
      targets: normalizedTargets.map((target) => ({
        url: target.url,
        region: target.region,
        weight: target.weight,
      })),
      timeoutMs: draft.runtime.timeoutMs,
      request: {
        contentType: DEFAULT_SERVICE_REQUEST_CONTENT_TYPE,
        schema: inputSchema,
      },
      response: {
        schema: outputSchema,
      },
      headersTemplate: {
        [DEFAULT_SERVICE_REQUEST_ID_HEADER]: "{{requestId}}",
      },
      examples: examples as Array<Record<string, unknown>>,
    },
  };
}

type ServiceRegistryPayloadOverrides = Partial<Omit<ServiceRegistryPayload, "invoke">> & {
  auth?: Partial<NonNullable<ServiceRegistryPayload["auth"]>>;
  healthCheck?: Partial<NonNullable<ServiceRegistryPayload["healthCheck"]>>;
  constraints?: Partial<NonNullable<ServiceRegistryPayload["constraints"]>>;
  forwarding?: Partial<NonNullable<ServiceRegistryPayload["forwarding"]>>;
  metering?: Partial<NonNullable<ServiceRegistryPayload["metering"]>>;
  invoke?: Partial<Omit<ServiceRegistryPayload["invoke"], "request" | "response">> & {
    request?: Partial<ServiceRegistryPayload["invoke"]["request"]>;
    response?: Partial<ServiceRegistryPayload["invoke"]["response"]>;
  };
};

function resolveInvokeTargets(service: ServiceRegistryRecord): Array<{ url: string; weight?: number; region?: string }> {
  const targets = Array.isArray(service.invoke?.targets) && service.invoke.targets.length > 0
    ? service.invoke.targets
    : [];
  if (targets.length > 0) {
    return targets;
  }
  if (service.endpoint) {
    return [{ url: service.endpoint, weight: 100 }];
  }
  return [];
}

function buildBaseServicePayload(service: ServiceRegistryRecord): ServiceRegistryPayload {
  const invokeTargets = resolveInvokeTargets(service);

  return {
    id: service.id,
    serviceId: service.serviceId,
    createdAt: String(service.createdAt || ""),
    updatedAt: nowDateTimeString(),
    serviceName: service.serviceName || service.name || service.serviceId,
    role: service.role,
    address: service.address,
    pricing: typeof service.pricing === "string"
      ? service.pricing
      : {
          currency: String(service.pricing?.currency || DEFAULT_SERVICE_SETTLEMENT_CURRENCY),
          amount: String(service.pricing?.amount || "0.01"),
        },
    isActive: Boolean(service.isActive),
    summary: service.summary || "",
    tags: service.tags || [],
    status: service.isActive ? "active" : "inactive",
    auth: {
      type: service.auth?.type || DEFAULT_SERVICE_AUTH_TYPE,
      headerName: service.auth?.headerName || DEFAULT_SERVICE_AUTH_HEADER_NAME,
    },
    healthCheck: {
      path: service.healthCheck?.path || DEFAULT_SERVICE_HEALTH_PATH,
      method: service.healthCheck?.method || DEFAULT_SERVICE_HEALTH_METHOD,
      intervalSec: Number(service.healthCheck?.intervalSec || 30),
      timeoutMs: Number(service.healthCheck?.timeoutMs || DEFAULT_SERVICE_HEALTH_TIMEOUT_MS),
      successCodes: service.healthCheck?.successCodes || DEFAULT_SERVICE_HEALTH_SUCCESS_CODES,
      healthyThreshold: Number(service.healthCheck?.healthyThreshold || DEFAULT_SERVICE_HEALTHY_THRESHOLD),
      unhealthyThreshold: Number(service.healthCheck?.unhealthyThreshold || DEFAULT_SERVICE_UNHEALTHY_THRESHOLD),
    },
    constraints: {
      timeoutMs: Number(service.constraints?.timeoutMs || service.invoke?.timeoutMs || 3000),
      maxResponseBytes: Number(service.constraints?.maxResponseBytes || 2048),
      maxRequestBytes: Number(service.constraints?.maxRequestBytes || 4096),
      maxQps: Number(service.constraints?.maxQps || 50),
    },
    forwarding: {
      requestIdHeader: service.forwarding?.requestIdHeader || DEFAULT_SERVICE_REQUEST_ID_HEADER,
      passThroughHeaders: service.forwarding?.passThroughHeaders || [],
      injectHeaders: service.forwarding?.injectHeaders || {},
      retryPolicy: {
        maxAttempts: Number(service.forwarding?.retryPolicy?.maxAttempts || DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS),
        backoffMs: Number(service.forwarding?.retryPolicy?.backoffMs || DEFAULT_SERVICE_RETRY_BACKOFF_MS),
        retryOnStatus: service.forwarding?.retryPolicy?.retryOnStatus || [...DEFAULT_SERVICE_RETRY_ON_STATUS],
      },
    },
    metering: {
      billingUnit: service.metering?.billingUnit || DEFAULT_SERVICE_BILLING_UNIT,
      billOnError: Boolean(service.metering?.billOnError),
      billableStatusClasses: service.metering?.billableStatusClasses || DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES,
      requestIdRequired: service.metering?.requestIdRequired !== false,
      responseSizeMetering: service.metering?.responseSizeMetering !== false,
    },
    invoke: {
      method: service.invoke?.method || DEFAULT_SERVICE_INVOKE_METHOD,
      url: service.invoke?.url || invokeTargets[0]?.url || service.endpoint || "",
      targets: invokeTargets,
      timeoutMs: Number(service.invoke?.timeoutMs || service.constraints?.timeoutMs || 3000),
      request: {
        contentType: service.invoke?.request?.contentType || DEFAULT_SERVICE_REQUEST_CONTENT_TYPE,
        schema: service.invoke?.request?.schema || { type: "object", properties: {} },
      },
      response: {
        schema: service.invoke?.response?.schema || { type: "object", properties: {} },
      },
      headersTemplate: service.invoke?.headersTemplate,
      examples: service.invoke?.examples,
    },
  };
}

function mergeServiceRegistryPayload(
  base: ServiceRegistryPayload,
  overrides: ServiceRegistryPayloadOverrides,
): ServiceRegistryPayload {
  const baseForwarding = base.forwarding ?? {
    requestIdHeader: DEFAULT_SERVICE_REQUEST_ID_HEADER,
    passThroughHeaders: [],
    injectHeaders: {},
    retryPolicy: {
      maxAttempts: DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS,
      backoffMs: DEFAULT_SERVICE_RETRY_BACKOFF_MS,
      retryOnStatus: [...DEFAULT_SERVICE_RETRY_ON_STATUS],
    },
  };

  return {
    ...base,
    ...overrides,
    auth: overrides.auth ? { ...base.auth, ...overrides.auth } : base.auth,
    healthCheck: overrides.healthCheck ? { ...base.healthCheck, ...overrides.healthCheck } : base.healthCheck,
    constraints: overrides.constraints ? { ...base.constraints, ...overrides.constraints } : base.constraints,
    forwarding: overrides.forwarding
      ? {
          ...baseForwarding,
          ...overrides.forwarding,
          retryPolicy: overrides.forwarding.retryPolicy
            ? { ...baseForwarding.retryPolicy, ...overrides.forwarding.retryPolicy }
            : baseForwarding.retryPolicy,
        }
      : base.forwarding,
    metering: overrides.metering ? { ...base.metering, ...overrides.metering } : base.metering,
    invoke: overrides.invoke
      ? {
          ...base.invoke,
          ...overrides.invoke,
          request: overrides.invoke.request ? { ...base.invoke.request, ...overrides.invoke.request } : base.invoke.request,
          response: overrides.invoke.response ? { ...base.invoke.response, ...overrides.invoke.response } : base.invoke.response,
        }
      : base.invoke,
  };
}

function normalizeFinalPayload(payload: ServiceRegistryPayload): ServiceRegistryPayload {
  const finalTargets = Array.isArray(payload.invoke.targets)
    ? payload.invoke.targets.filter((item) => Boolean(item?.url))
    : [];
  const finalInvokeUrl = payload.invoke.url || finalTargets[0]?.url || "";
  if (!finalInvokeUrl || finalTargets.length === 0) {
    throw new Error("Service invoke target is missing. Open Edit Manifest and save a valid endpoint first.");
  }

  return {
    ...payload,
    status: payload.isActive ? "active" : "inactive",
    invoke: {
      ...payload.invoke,
      url: finalInvokeUrl,
      targets: finalTargets,
    },
  };
}

export function buildServiceRegistryPayload(
  service: ServiceRegistryRecord,
  overrides: ServiceRegistryPayloadOverrides = {},
): ServiceRegistryPayload {
  return normalizeFinalPayload(
    mergeServiceRegistryPayload(buildBaseServicePayload(service), overrides)
  );
}

export function buildServiceStatusUpdatePayload(
  service: ServiceRegistryRecord,
  nextActive: boolean,
): ServiceRegistryPayload {
  return buildServiceRegistryPayload(service, {
    isActive: nextActive,
    status: nextActive ? "active" : "inactive",
  });
}

export function buildOptimisticServiceRecord(
  service: ServiceRegistryRecord,
  payload: ServiceRegistryPayload,
): ServiceRegistryRecord {
  return {
    ...service,
    serviceName: payload.serviceName,
    name: payload.serviceName,
    summary: payload.summary || "",
    pricing: typeof payload.pricing === "string" ? payload.pricing : payload.pricing.amount,
    isActive: payload.isActive,
    status: payload.isActive ? "active" : "inactive",
    tags: payload.tags,
    auth: payload.auth || null,
    healthCheck: payload.healthCheck || null,
    constraints: payload.constraints || null,
    forwarding: payload.forwarding || null,
    metering: payload.metering || null,
    invoke: {
      ...payload.invoke,
      url: payload.invoke.url || service.invoke?.url || service.endpoint || "",
    },
    updatedAt: payload.updatedAt,
  };
}

export function parseCsvText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCsvNumbers(value: string): number[] {
  return parseCsvText(value)
    .map((item) => Number.parseInt(item, 10))
    .filter((num) => Number.isFinite(num));
}

export function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function parseObjectJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function parseTargetsJson(value: string): Array<{ url: string; weight?: number; region?: string }> {
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

export type ServiceEditDraft = {
  serviceName: string;
  summary: string;
  pricingAmount: string;
  isActive: boolean;
  authType: string;
  authHeaderName: string;
  tagsText: string;
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

export const DEFAULT_SERVICE_PRICING_AMOUNT = "0.01";

export const SERVICE_CONSTRAINT_LIMITS = {
  timeoutMs: { min: 300, max: 15000 },
  maxRequestBytes: { min: 256, max: 262144 },
  maxResponseBytes: { min: 256, max: 1048576 },
  maxQps: { min: 1, max: 200 },
} as const;

export const SERVICE_EDIT_CONSTRAINT_LIMITS = SERVICE_CONSTRAINT_LIMITS;

export const SERVICE_EDIT_DRAFT_DEFAULTS = {
  timeoutMs: 3000,
  maxRequestBytes: 4096,
  maxResponseBytes: 2048,
  maxQps: 50,
} as const;

export const SERVICE_DEPLOY_DRAFT_DEFAULTS = {
  timeoutMs: 15000,
  maxRequestBytes: 4096,
  maxResponseBytes: 4096,
  maxQps: 50,
} as const;

export const DEFAULT_SERVICE_EDIT_DRAFT_CONFIG = {
  pricingFallback: DEFAULT_SERVICE_PRICING_AMOUNT,
  defaultTimeoutMs: SERVICE_EDIT_DRAFT_DEFAULTS.timeoutMs,
  defaultMaxRequestBytes: SERVICE_EDIT_DRAFT_DEFAULTS.maxRequestBytes,
  defaultMaxResponseBytes: SERVICE_EDIT_DRAFT_DEFAULTS.maxResponseBytes,
  defaultMaxQps: SERVICE_EDIT_DRAFT_DEFAULTS.maxQps,
} as const;

export const DEFAULT_SERVICE_DEPLOY_DRAFT_CONFIG = {
  pricingFallback: DEFAULT_SERVICE_PRICING_AMOUNT,
  defaultTimeoutMs: SERVICE_DEPLOY_DRAFT_DEFAULTS.timeoutMs,
  defaultMaxRequestBytes: SERVICE_DEPLOY_DRAFT_DEFAULTS.maxRequestBytes,
  defaultMaxResponseBytes: SERVICE_DEPLOY_DRAFT_DEFAULTS.maxResponseBytes,
  defaultMaxQps: SERVICE_DEPLOY_DRAFT_DEFAULTS.maxQps,
} as const;

export type ServiceEditDraftConfig = {
  pricingFallback: string;
  defaultTimeoutMs: number;
  defaultMaxRequestBytes: number;
  defaultMaxResponseBytes: number;
  defaultMaxQps: number;
};

export type ServiceEditValidation = {
  isValid: boolean;
  firstError: string | null;
  errors: Record<string, string>;
};

export type ServiceEditValidationConfig = {
  timeoutMs: { min: number; max: number };
  maxRequestBytes: { min: number; max: number };
  maxResponseBytes: { min: number; max: number };
  maxQps: { min: number; max: number };
};

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

export function buildEditDraftFromService(
  service: ServiceRegistryRecord,
  config: ServiceEditDraftConfig,
): ServiceEditDraft {
  const invokeTargets = service.invoke?.targets || (service.endpoint ? [{ url: service.endpoint, weight: 100 }] : []);
  const invokeUrl = service.invoke?.url || invokeTargets[0]?.url || service.endpoint || "";

  return {
    serviceName: service.serviceName || service.name || "",
    summary: service.summary || "",
    pricingAmount: extractPricingAmount(service.pricing, config.pricingFallback),
    isActive: Boolean(service.isActive),
    authType: service.auth?.type || DEFAULT_SERVICE_AUTH_TYPE,
    authHeaderName: service.auth?.headerName || DEFAULT_SERVICE_AUTH_HEADER_NAME,
    tagsText: (service.tags || []).join(", "),
    healthPath: service.healthCheck?.path || DEFAULT_SERVICE_HEALTH_PATH,
    healthMethod: service.healthCheck?.method || DEFAULT_SERVICE_HEALTH_METHOD,
    healthIntervalSec: String(service.healthCheck?.intervalSec ?? 30),
    healthTimeoutMs: String(service.healthCheck?.timeoutMs ?? DEFAULT_SERVICE_HEALTH_TIMEOUT_MS),
    healthSuccessCodesText: (service.healthCheck?.successCodes || DEFAULT_SERVICE_HEALTH_SUCCESS_CODES).join(","),
    healthyThreshold: String(service.healthCheck?.healthyThreshold ?? DEFAULT_SERVICE_HEALTHY_THRESHOLD),
    unhealthyThreshold: String(service.healthCheck?.unhealthyThreshold ?? DEFAULT_SERVICE_UNHEALTHY_THRESHOLD),
    constraintsTimeoutMs: String(service.constraints?.timeoutMs ?? service.invoke?.timeoutMs ?? config.defaultTimeoutMs),
    constraintsMaxResponseBytes: String(service.constraints?.maxResponseBytes ?? config.defaultMaxResponseBytes),
    constraintsMaxRequestBytes: String(service.constraints?.maxRequestBytes ?? config.defaultMaxRequestBytes),
    constraintsMaxQps: String(service.constraints?.maxQps ?? config.defaultMaxQps),
    requestIdHeader: service.forwarding?.requestIdHeader || DEFAULT_SERVICE_REQUEST_ID_HEADER,
    passThroughHeadersText: (service.forwarding?.passThroughHeaders || []).join(", "),
    injectHeadersJson: JSON.stringify(service.forwarding?.injectHeaders || {}, null, 2),
    retryMaxAttempts: String(service.forwarding?.retryPolicy?.maxAttempts ?? DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS),
    retryBackoffMs: String(service.forwarding?.retryPolicy?.backoffMs ?? DEFAULT_SERVICE_RETRY_BACKOFF_MS),
    retryOnStatusText: (service.forwarding?.retryPolicy?.retryOnStatus || DEFAULT_SERVICE_RETRY_ON_STATUS).join(","),
    billingUnit: service.metering?.billingUnit || DEFAULT_SERVICE_BILLING_UNIT,
    billOnError: Boolean(service.metering?.billOnError),
    requestIdRequired: service.metering?.requestIdRequired !== false,
    responseSizeMetering: service.metering?.responseSizeMetering !== false,
    invokeMethod: service.invoke?.method || DEFAULT_SERVICE_INVOKE_METHOD,
    invokeUrl,
    invokeTimeoutMs: String(service.invoke?.timeoutMs ?? 3000),
    invokeTargetsJson: JSON.stringify(invokeTargets, null, 2),
    requestSchemaJson: JSON.stringify(service.invoke?.request?.schema || { type: "object", properties: {} }, null, 2),
    responseSchemaJson: JSON.stringify(service.invoke?.response?.schema || { type: "object", properties: {} }, null, 2),
  };
}

export function validateServiceEditDraft(
  draft: ServiceEditDraft | null,
  limits: ServiceEditValidationConfig,
): ServiceEditValidation {
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

  validateConstraintField(draft.constraintsTimeoutMs, "constraintsTimeoutMs", limits.timeoutMs, errors, "Constraint timeout");
  validateConstraintField(draft.constraintsMaxRequestBytes, "constraintsMaxRequestBytes", limits.maxRequestBytes, errors, "Max request bytes");
  validateConstraintField(draft.constraintsMaxResponseBytes, "constraintsMaxResponseBytes", limits.maxResponseBytes, errors, "Max response bytes");
  validateConstraintField(draft.constraintsMaxQps, "constraintsMaxQps", limits.maxQps, errors, "Max QPS");

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

export function buildServicePayloadFromEditDraft(
  service: ServiceRegistryRecord,
  draft: ServiceEditDraft,
  config: ServiceEditDraftConfig,
): ServiceRegistryPayload {
  const normalizedPath = draft.healthPath.trim().startsWith("/")
    ? draft.healthPath.trim()
    : `/${draft.healthPath.trim() || "health"}`;

  const invokeTargets = parseTargetsJson(draft.invokeTargetsJson);
  const requestSchema = parseObjectJson(draft.requestSchemaJson);
  const responseSchema = parseObjectJson(draft.responseSchemaJson);
  const injectHeadersRaw = parseObjectJson(draft.injectHeadersJson);
  const injectHeaders = Object.entries(injectHeadersRaw).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") {
      acc[key] = value;
    }
    return acc;
  }, {});

  const tags = Array.from(new Set(parseCsvText(draft.tagsText)));
  const passThroughHeaders = parseCsvText(draft.passThroughHeadersText);
  const successCodes = parseCsvNumbers(draft.healthSuccessCodesText);
  const retryOnStatus = parseCsvNumbers(draft.retryOnStatusText);
  const invokeUrl = draft.invokeUrl.trim() || invokeTargets[0]?.url || "";

  if (!invokeUrl) {
    throw new Error("Invoke URL is required");
  }

  return buildServiceRegistryPayload(service, {
    updatedAt: nowDateTimeString(),
    serviceName: draft.serviceName.trim(),
    pricing: {
      currency: DEFAULT_SERVICE_SETTLEMENT_CURRENCY,
      amount: draft.pricingAmount.trim() || "0.01",
    },
    isActive: draft.isActive,
    status: draft.isActive ? "active" : "inactive",
    summary: draft.summary.trim(),
    tags,
    auth: {
      type: service.auth?.type || DEFAULT_SERVICE_AUTH_TYPE,
      headerName: service.auth?.headerName || DEFAULT_SERVICE_AUTH_HEADER_NAME,
    },
    healthCheck: {
      path: normalizedPath,
      method: draft.healthMethod,
      intervalSec: parsePositiveInt(draft.healthIntervalSec, 30),
      timeoutMs: parsePositiveInt(draft.healthTimeoutMs, DEFAULT_SERVICE_HEALTH_TIMEOUT_MS),
      successCodes: successCodes.length > 0 ? successCodes : DEFAULT_SERVICE_HEALTH_SUCCESS_CODES,
      healthyThreshold: parsePositiveInt(draft.healthyThreshold, DEFAULT_SERVICE_HEALTHY_THRESHOLD),
      unhealthyThreshold: parsePositiveInt(draft.unhealthyThreshold, DEFAULT_SERVICE_UNHEALTHY_THRESHOLD),
    },
    constraints: {
      timeoutMs: parsePositiveInt(draft.constraintsTimeoutMs, config.defaultTimeoutMs),
      maxResponseBytes: parsePositiveInt(draft.constraintsMaxResponseBytes, config.defaultMaxResponseBytes),
      maxRequestBytes: parsePositiveInt(draft.constraintsMaxRequestBytes, config.defaultMaxRequestBytes),
      maxQps: parsePositiveInt(draft.constraintsMaxQps, config.defaultMaxQps),
    },
    forwarding: {
      requestIdHeader: draft.requestIdHeader.trim() || DEFAULT_SERVICE_REQUEST_ID_HEADER,
      passThroughHeaders,
      injectHeaders,
      retryPolicy: {
        maxAttempts: parsePositiveInt(draft.retryMaxAttempts, DEFAULT_SERVICE_RETRY_MAX_ATTEMPTS),
        backoffMs: parsePositiveInt(draft.retryBackoffMs, DEFAULT_SERVICE_RETRY_BACKOFF_MS),
        retryOnStatus: retryOnStatus.length > 0 ? retryOnStatus : [...DEFAULT_SERVICE_RETRY_ON_STATUS],
      },
    },
    metering: {
      billingUnit: draft.billingUnit,
      billOnError: draft.billOnError,
      billableStatusClasses: service.metering?.billableStatusClasses || DEFAULT_SERVICE_BILLABLE_STATUS_CLASSES,
      requestIdRequired: draft.requestIdRequired,
      responseSizeMetering: draft.responseSizeMetering,
    },
    invoke: {
      method: draft.invokeMethod.trim() || DEFAULT_SERVICE_INVOKE_METHOD,
      url: invokeUrl,
      targets: invokeTargets,
      timeoutMs: parsePositiveInt(draft.invokeTimeoutMs, 3000),
      request: {
        contentType: service.invoke?.request?.contentType || DEFAULT_SERVICE_REQUEST_CONTENT_TYPE,
        schema: requestSchema,
      },
      response: {
        schema: responseSchema,
      },
      headersTemplate: service.invoke?.headersTemplate,
      examples: service.invoke?.examples,
    },
  });
}