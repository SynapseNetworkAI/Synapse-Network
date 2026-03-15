"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wand2, TerminalSquare, Server, X, Check, CircleHelp } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";
import { createServiceRegistry } from "@/utils/serviceApi";
import { nowDateTimeString } from "@/utils/time";
import AuthMask from "@/components/AuthMask";

const PARSE_CURL_ENDPOINT = `${getGatewayBaseUrl()}/api/v1/services/parse-curl`;
const TOOL_NAME_REGEX = /^[a-z0-9_-]+$/;
const INTENT_TAG_REGEX = /^[a-z0-9_-]{2,24}$/;
const AI_SERVICE_NAME_MIN = 4;
const AI_SERVICE_NAME_MAX = 80;
const AI_DESCRIPTION_MIN = 12;
const AI_DESCRIPTION_MAX = 240;
const AI_INTENT_MAX = 8;
const MAX_CLUSTER_TARGETS = 10;
const CONSTRAINT_TIMEOUT_MIN = 300;
const CONSTRAINT_TIMEOUT_MAX = 15000;
const CONSTRAINT_REQ_BYTES_MIN = 256;
const CONSTRAINT_REQ_BYTES_MAX = 262144;
const CONSTRAINT_RES_BYTES_MIN = 256;
const CONSTRAINT_RES_BYTES_MAX = 1048576;
const CONSTRAINT_QPS_MIN = 1;
const CONSTRAINT_QPS_MAX = 200;

type FieldGuideItem = {
  title: string;
  purpose: string;
  howToConfigure: string;
  platformUse: string;
  example?: string;
};

const FIELD_GUIDES: Record<string, FieldGuideItem> = {
  service_name: {
    title: "Service Name",
    purpose: "Human-readable service title for discovery and trust.",
    howToConfigure: "Use a clear product-like name, 4-80 chars.",
    platformUse: "Shown in marketplace and seller console cards.",
    example: "DeepSeek Market Analysis",
  },
  agent_tool_name: {
    title: "Agent Tool Name",
    purpose: "Stable machine key used by autonomous agents.",
    howToConfigure: "Use snake style with [a-z0-9_-], 3-64 chars.",
    platformUse: "Bound to routing identity and tracing headers.",
    example: "get_market_analysis",
  },
  description: {
    title: "Description",
    purpose: "Instruction for when/why agents should call this tool.",
    howToConfigure: "Write concrete trigger conditions in 12-240 chars.",
    platformUse: "Used by intent matching and buyer-side selection.",
  },
  intent: {
    title: "Intent Tags",
    purpose: "Semantic routing labels for discovery.",
    howToConfigure: "Add 1-8 tags, each 2-24 chars, lowercase preferred.",
    platformUse: "Improves recall and ranking in discover queries.",
    example: "market_data, crypto_research",
  },
  cluster_targets: {
    title: "Cluster Targets",
    purpose: "Active-active upstream endpoints.",
    howToConfigure: "One full URL per line; first target is primary weight.",
    platformUse: "Gateway routes with weighted target selection.",
    example: "https://a.example.com/infer",
  },
  health_check: {
    title: "Health Check Path",
    purpose: "Single probe path shared by all cluster nodes.",
    howToConfigure: "Use path only, start with '/'.",
    platformUse: "Gateway composes origin + path for each target probe.",
    example: "/health",
  },
  pricing: {
    title: "Price / Call",
    purpose: "Unit price in USDC for one successful call.",
    howToConfigure: "Use decimal format and align with your margin model.",
    platformUse: "Used by billing and settlement ledger.",
    example: "0.01",
  },
  timeout_ms: {
    title: "Timeout",
    purpose: "Maximum upstream response waiting time.",
    howToConfigure: "Start around 2000-5000ms for API workloads.",
    platformUse: "Feeds timeout control and reliability scoring.",
  },
  max_response_bytes: {
    title: "Max Response Bytes",
    purpose: "Safety limit for response payload size.",
    howToConfigure: "Set to real model output envelope size.",
    platformUse: "Protects gateway memory and billable traffic bounds.",
  },
  max_request_bytes: {
    title: "Max Request Bytes",
    purpose: "Safety limit for incoming request payload size.",
    howToConfigure: "Match your backend parser limits.",
    platformUse: "Rejects oversized traffic before forwarding.",
  },
  max_qps: {
    title: "Max QPS",
    purpose: "Advertised burst-safe request rate.",
    howToConfigure: "Set to proven load-test capacity.",
    platformUse: "Used by scheduler and rate protection.",
  },
  input_schema: {
    title: "Input Schema",
    purpose: "Expected JSON shape for request body.",
    howToConfigure: "Define strict fields and data types.",
    platformUse: "Used by AI caller contract understanding.",
  },
  output_schema: {
    title: "Output Schema",
    purpose: "Expected JSON shape for response body.",
    howToConfigure: "Expose stable keys and value types.",
    platformUse: "Improves downstream parsing and reliability.",
  },
};

function FieldGuideHint({ fieldKey }: { fieldKey: string }) {
  const guide = FIELD_GUIDES[fieldKey];
  if (!guide) return null;
  return (
    <details className="relative inline-block ml-1 align-middle group">
      <summary className="list-none cursor-pointer inline-flex items-center text-gray-500 hover:text-green-300">
        <CircleHelp className="w-3.5 h-3.5" />
      </summary>
      <div className="absolute z-30 mt-2 w-72 rounded-xl border border-gray-700 bg-[#0b0d12] p-3 text-[11px] shadow-2xl">
        <p className="text-white font-semibold">{guide.title}</p>
        <p className="mt-2 text-gray-300">{guide.purpose}</p>
        <p className="mt-2 text-gray-400">Configure: {guide.howToConfigure}</p>
        <p className="mt-1 text-gray-400">Platform: {guide.platformUse}</p>
        {guide.example && <p className="mt-1 text-green-300">Example: {guide.example}</p>}
      </div>
    </details>
  );
}

const OVERRIDABLE_PATHS = [
  "service_name",
  "agent_tool_name",
  "description",
  "intent",
  "endpoint",
  "health_check",
  "pricing.currency",
  "pricing.amount",
  "pricing.type",
  "constraints.max_response_bytes",
  "constraints.max_request_bytes",
  "constraints.timeout_ms",
  "constraints.max_qps",
  "input_schema",
  "output_schema",
] as const;

const readByPath = (obj: unknown, path: string): unknown => {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  return path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
};

const hasOwnByPath = (obj: unknown, path: string): boolean => {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  const keys = path.split(".");
  let cursor: unknown = obj;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object" || !(key in (cursor as Record<string, unknown>))) {
      return false;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return true;
};

const collectOverrideChanges = (parsed: Partial<ServiceManifest>, current: ServiceManifest): string[] => {
  const changed: string[] = [];
  for (const path of OVERRIDABLE_PATHS) {
    if (!hasOwnByPath(parsed, path)) {
      continue;
    }
    const nextValue = readByPath(parsed, path);
    const currentValue = readByPath(current, path);
    if (JSON.stringify(nextValue) !== JSON.stringify(currentValue)) {
      changed.push(path);
    }
  }
  return changed;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const normalizeIntentTag = (raw: string): string => {
  return raw.trim().toLowerCase().replaceAll(/\s+/g, "_");
};

const normalizeHealthCheckPath = (raw: string): string => {
  const value = String(raw || "").trim();
  if (!value) {
    return "/health";
  }

  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      const path = `${parsed.pathname || "/"}${parsed.search || ""}`;
      return path.startsWith("/") ? path : `/${path}`;
    } catch {
      // Fall back to raw normalization below.
    }
  }

  return value.startsWith("/") ? value : `/${value}`;
};

// Extracted from api_gateway_reverse_proxy_design.md
interface ServiceManifest {
  service_name: string;
  agent_tool_name: string;
  description: string;
  intent: string[];
  endpoint: string;
  health_check: string;
  pricing: {
    currency: string;
    amount: string;
    type: string;
  };
  constraints: {
    max_response_bytes: number;
    max_request_bytes: number;
    timeout_ms: number;
    max_qps: number;
  };
  input_schema: object;
  output_schema: object;
}

export default function DeployManifestPage() {
  const router = useRouter();
  const { address } = useAccount();
  const [manifest, setManifest] = useState<ServiceManifest>({
    service_name: "",
    agent_tool_name: "",
    description: "",
    intent: [],
    endpoint: "",
    health_check: "",
    pricing: {
      currency: "USDC",
      amount: "0.01",
      type: "per_call",
    },
    constraints: {
      max_response_bytes: 2048,
      max_request_bytes: 4096,
      timeout_ms: 3000,
      max_qps: 50,
    },
    input_schema: {},
    output_schema: {},
  });

  const [intentInput, setIntentInput] = useState("");
  const [endpointTargetsInput, setEndpointTargetsInput] = useState("");
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiCurl, setAICurl] = useState("");
  const [aiResponse, setAIResponse] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    const draft = localStorage.getItem("synapse_manifest_draft");
    if (draft) {
      setHasDraft(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("synapse_manifest_draft", JSON.stringify(manifest));
  }, [manifest]);

  useEffect(() => {
    setEndpointTargetsInput((prev) => {
      if (prev.trim()) {
        return prev;
      }
      return manifest.endpoint ? `${manifest.endpoint}\n` : "";
    });
  }, [manifest.endpoint]);

  const handleRestoreDraft = () => {
    const draft = localStorage.getItem("synapse_manifest_draft");
    if (draft) {
      try {
        setManifest(JSON.parse(draft));
        toast.success("Unsaved progress restored!", { icon: "📦" });
        setHasDraft(false);
      } catch (e) {
        console.error("Draft parsing failed", e);
      }
    }
  };

  const handleUpdate = (field: string, value: unknown) => {
    setManifest((prev) => {
      const keys = field.split(".");
      if (keys.length === 1) {
        return { ...prev, [field]: value };
      }
      return {
        ...prev,
        [keys[0]]: {
          ...(prev[keys[0] as keyof ServiceManifest] as object),
          [keys[1]]: value,
        },
      };
    });
  };

  const handleAddIntent = () => {
    const normalizedTag = normalizeIntentTag(intentInput);
    if (!normalizedTag) {
      return;
    }
    if (!INTENT_TAG_REGEX.test(normalizedTag)) {
      toast.error("Intent tag must match [a-z0-9_-] and be 2-24 chars.");
      return;
    }
    if (manifest.intent.includes(normalizedTag)) {
      toast("Intent already exists.", { icon: "ℹ️" });
      return;
    }
    if (manifest.intent.length >= AI_INTENT_MAX) {
      toast.error(`Maximum ${AI_INTENT_MAX} intent tags allowed.`);
      return;
    }
    handleUpdate("intent", [...manifest.intent, normalizedTag]);
    setIntentInput("");
  };

  const handleRemoveIntent = (tag: string) => {
    handleUpdate(
      "intent",
      manifest.intent.filter((t) => t !== tag)
    );
  };

  const applyParsedManifest = (parsed: unknown) => {
    if (!isObjectRecord(parsed)) {
      return false;
    }

    const normalized = parsed as Partial<ServiceManifest>;
    const normalizedHealthCheck =
      typeof normalized.health_check === "string"
        ? normalizeHealthCheckPath(normalized.health_check)
        : undefined;
    setManifest((prev) => ({
      ...prev,
      ...normalized,
      ...(normalizedHealthCheck ? { health_check: normalizedHealthCheck } : {}),
      input_schema: normalized.input_schema || prev.input_schema,
      output_schema: normalized.output_schema || prev.output_schema,
      pricing: normalized.pricing || prev.pricing,
      constraints: normalized.constraints || prev.constraints,
    }));
    return true;
  };

  const confirmAndInject = () => {
    try {
      const parsed = JSON.parse(aiResponse) as Partial<ServiceManifest>;
      const changes = collectOverrideChanges(parsed, manifest);
      const isMissingRequired = !parsed.service_name || !parsed.agent_tool_name || !parsed.endpoint;
      if (isMissingRequired) {
         toast.error("Please fill in missing required fields.");
      }
      if (changes.length === 0) {
        toast("No manifest changes detected.", { icon: "ℹ️" });
        return;
      }
      const applied = applyParsedManifest(parsed);
      if (!applied) {
        toast.error("Parsed payload is empty or invalid JSON object.");
        return;
      }
      setShowAIModal(false);
      toast.success(`Applied ${changes.length} field updates to form.`);
    } catch {
      toast.error("Valid JSON is required in the right panel!");
    }
  };

  const parsedPreview = useMemo(() => {
    if (!aiResponse.trim()) {
      return null;
    }
    try {
      return JSON.parse(aiResponse) as Partial<ServiceManifest>;
    } catch {
      return null;
    }
  }, [aiResponse]);

  const overrideChanges = useMemo(() => {
    if (!parsedPreview) {
      return [];
    }
    return collectOverrideChanges(parsedPreview, manifest);
  }, [parsedPreview, manifest]);

  const parsedClusterTargets = useMemo(() => {
    const fromInput = endpointTargetsInput
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, MAX_CLUSTER_TARGETS);
    if (fromInput.length > 0) {
      return fromInput;
    }
    const endpoint = manifest.endpoint.trim();
    return endpoint ? [endpoint] : [];
  }, [endpointTargetsInput, manifest.endpoint]);

  const autofillAIMagic = async () => {
    setIsAiGenerating(true);
    try {
      if (!address) {
        throw new Error("Wallet not connected. Please connect wallet and sign in first.");
      }

      // Create request payload
      const requestData = {
        curlCommand: aiCurl,
        model: "deepseek-chat", // Let backend configure or override it
        currentManifest: manifest
      };

      // Call real gateway parser endpoint
      const res = await fetch(PARSE_CURL_ENDPOINT, {
        method: "POST",
        headers: buildAuthedHeaders(address),
        body: JSON.stringify(requestData)
      });
      
      if (!res.ok) {
        const raw = await res.text();
        throw new Error(normalizeAuthApiError(raw || "Failed to parse cURL", res.status));
      }
      
      const payload = await res.json();
      
      if (payload.status === "success") {
        let parsed: unknown = payload.data ?? payload.parsed ?? payload.manifest ?? payload.result;
        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch {
            parsed = null;
          }
        }
        if (!isObjectRecord(parsed)) {
          toast("Parser is not returning a structured manifest yet. Please edit fields manually.", { icon: "ℹ️" });
          return;
        }
        setAIResponse(JSON.stringify(parsed, null, 2));
        if (payload.fallback) {
          toast("Parsed via fallback parser. Review JSON and click Confirm Override.", { icon: "⚙️" });
        } else {
          toast.success("AI manifest generated. Review JSON and click Confirm Override.", { icon: "🪄" });
        }
      } else {
        throw new Error(payload.detail || "Unknown parsing error");
      }
    } catch (e) {
      console.error("AI Parse Error:", e);
      const errMsg = e instanceof Error ? e.message : "Failed to parse cURL via AI.";
      if (errMsg.includes("Wallet auth session missing")) {
        toast.error("Session missing or expired. Please sign in with wallet again.");
      } else {
        toast.error(errMsg);
      }
    } finally {
      setIsAiGenerating(false);
    }
  };

  const submitDeploy = async () => {
    if (aiInterfaceValidationErrors.length > 0) {
      toast.error(`AI interface validation failed: ${aiInterfaceValidationErrors[0]}`);
      return;
    }
    if (!address) {
      toast.error("Wallet not connected. Please connect wallet and sign in first.");
      return;
    }
    setIsDeploying(true);
    try {
      const normalizedTargets = parsedClusterTargets.filter((value) => /^https?:\/\//i.test(value));

      if (normalizedTargets.length === 0) {
        toast.error("At least one valid cluster endpoint URL is required.");
        return;
      }

      const healthCheckPathRaw = manifest.health_check.trim() || "/health";
      const healthCheckPath = healthCheckPathRaw.startsWith("/") ? healthCheckPathRaw : `/${healthCheckPathRaw}`;
      const defaultBillableStatusClasses = [2] as const;

      const payload = {
        serviceName: manifest.service_name.trim(),
        createdAt: nowDateTimeString(),
        updatedAt: nowDateTimeString(),
        role: "Provider / Seller",
        address,
        pricing: manifest.pricing.amount,
        isActive: true,
        status: "active" as const,
        summary: manifest.description.trim(),
        tags: manifest.intent,
        auth: {
          type: "service_key",
          headerName: "X-Credential",
        },
        healthCheck: {
          path: healthCheckPath,
          method: "GET" as const,
          intervalSec: 30,
          timeoutMs: Math.min(5000, manifest.constraints.timeout_ms),
          successCodes: [200],
          healthyThreshold: 2,
          unhealthyThreshold: 3,
        },
        constraints: {
          timeoutMs: manifest.constraints.timeout_ms,
          maxResponseBytes: manifest.constraints.max_response_bytes,
          maxRequestBytes: manifest.constraints.max_request_bytes,
          maxQps: manifest.constraints.max_qps,
        },
        forwarding: {
          requestIdHeader: "X-Synapse-Request-Id",
          passThroughHeaders: ["X-Trace-Id", "X-Client-Version"],
          injectHeaders: {
            "X-Synapse-Service-Id": manifest.agent_tool_name.trim(),
          },
          retryPolicy: {
            maxAttempts: 2,
            backoffMs: 200,
            retryOnStatus: [429, 500, 502, 503, 504],
          },
        },
        metering: {
          billingUnit: "per_call" as const,
          billOnError: false,
          billableStatusClasses: [...defaultBillableStatusClasses],
          requestIdRequired: true,
          responseSizeMetering: true,
        },
        invoke: {
          method: "POST",
          targets: normalizedTargets.map((url, index) => ({
            url,
            weight: index === 0 ? 100 : 80,
          })),
          timeoutMs: manifest.constraints.timeout_ms,
          request: {
            contentType: "application/json",
            schema: manifest.input_schema as Record<string, unknown>,
          },
          response: {
            schema: manifest.output_schema as Record<string, unknown>,
          },
          headersTemplate: {
            "X-Synapse-Request-Id": "{{requestId}}",
          },
          examples: [],
        },
      };

      await createServiceRegistry(payload, address);
      localStorage.removeItem("synapse_manifest_draft");
      toast.success("导入成功");
      router.replace("/dashboard/provider/nodes");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Failed to deploy manifest";
      toast.error(errMsg);
    } finally {
      setIsDeploying(false);
    }
  };

  const readinessChecks = [
    { label: "Service name", ok: Boolean(manifest.service_name.trim()) },
    { label: "Tool name", ok: Boolean(manifest.agent_tool_name.trim()) },
    { label: "Description", ok: Boolean(manifest.description.trim()) },
    { label: "Semantic intents", ok: manifest.intent.length > 0 },
    { label: "Cluster targets", ok: parsedClusterTargets.length > 0 },
    { label: "Health path", ok: Boolean((manifest.health_check || "/health").trim()) },
  ];

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const serviceName = manifest.service_name.trim();
    const toolName = manifest.agent_tool_name.trim();
    const description = manifest.description.trim();

    if (!serviceName) {
      errors.service_name = "Service Name is required.";
    } else if (serviceName.length < AI_SERVICE_NAME_MIN || serviceName.length > AI_SERVICE_NAME_MAX) {
      errors.service_name = `Service Name must be ${AI_SERVICE_NAME_MIN}-${AI_SERVICE_NAME_MAX} characters.`;
    }

    if (!toolName) {
      errors.agent_tool_name = "Agent Tool Name is required.";
    } else if (toolName.length < 3 || toolName.length > 64) {
      errors.agent_tool_name = "Agent Tool Name must be 3-64 characters.";
    } else if (!TOOL_NAME_REGEX.test(toolName)) {
      errors.agent_tool_name = "Agent Tool Name must match ^[a-z0-9_-]+$.";
    }

    if (!description) {
      errors.description = "Description is required.";
    } else if (description.length < AI_DESCRIPTION_MIN || description.length > AI_DESCRIPTION_MAX) {
      errors.description = `Description must be ${AI_DESCRIPTION_MIN}-${AI_DESCRIPTION_MAX} characters.`;
    }

    if (manifest.intent.length < 1) {
      errors.intent = "At least one intent tag is required.";
    } else if (manifest.intent.length > AI_INTENT_MAX) {
      errors.intent = `Intent tags cannot exceed ${AI_INTENT_MAX}.`;
    }
    for (const tag of manifest.intent) {
      if (!INTENT_TAG_REGEX.test(tag)) {
        errors.intent = `Invalid intent tag "${tag}". Use [a-z0-9_-], 2-24 chars.`;
        break;
      }
    }

    if (parsedClusterTargets.length < 1) {
      errors.cluster_targets = "At least one cluster endpoint URL is required.";
    } else if (parsedClusterTargets.length > MAX_CLUSTER_TARGETS) {
      errors.cluster_targets = `Cluster targets cannot exceed ${MAX_CLUSTER_TARGETS}.`;
    }
    if (parsedClusterTargets.some((value) => !/^https?:\/\//i.test(value))) {
      errors.cluster_targets = "Every cluster endpoint must start with http:// or https://.";
    }

    const healthCheckPathRaw = (manifest.health_check || "/health").trim();
    if (!healthCheckPathRaw.startsWith("/")) {
      errors.health_check = "Health check path must start with / (for example /health).";
    }

    const timeoutMs = Number(manifest.constraints.timeout_ms || 0);
    const maxReqBytes = Number(manifest.constraints.max_request_bytes || 0);
    const maxResBytes = Number(manifest.constraints.max_response_bytes || 0);
    const maxQps = Number(manifest.constraints.max_qps || 0);

    if (timeoutMs < CONSTRAINT_TIMEOUT_MIN || timeoutMs > CONSTRAINT_TIMEOUT_MAX) {
      errors.timeout_ms = `Timeout must be ${CONSTRAINT_TIMEOUT_MIN}-${CONSTRAINT_TIMEOUT_MAX} ms.`;
    }
    if (maxReqBytes < CONSTRAINT_REQ_BYTES_MIN || maxReqBytes > CONSTRAINT_REQ_BYTES_MAX) {
      errors.max_request_bytes = `Max Request Bytes must be ${CONSTRAINT_REQ_BYTES_MIN}-${CONSTRAINT_REQ_BYTES_MAX}.`;
    }
    if (maxResBytes < CONSTRAINT_RES_BYTES_MIN || maxResBytes > CONSTRAINT_RES_BYTES_MAX) {
      errors.max_response_bytes = `Max Response Bytes must be ${CONSTRAINT_RES_BYTES_MIN}-${CONSTRAINT_RES_BYTES_MAX}.`;
    }
    if (maxQps < CONSTRAINT_QPS_MIN || maxQps > CONSTRAINT_QPS_MAX) {
      errors.max_qps = `Max QPS must be ${CONSTRAINT_QPS_MIN}-${CONSTRAINT_QPS_MAX}.`;
    }

    return errors;
  }, [manifest, parsedClusterTargets]);

  const aiInterfaceValidationErrors = useMemo(() => Object.values(fieldErrors), [fieldErrors]);

  const completedChecks = readinessChecks.filter((item) => item.ok).length;
  const isManifestReady = completedChecks === readinessChecks.length;
  const readinessPercent = Math.round((completedChecks / readinessChecks.length) * 100);
  const missingRequiredFields = readinessChecks.filter((item) => !item.ok).map((item) => item.label);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)).length;
  const formattedPrice = `${manifest.pricing.amount || "0"} ${manifest.pricing.currency}`;

  return (
    <AuthMask
      allowChallengeAuthorize={false}
      sessionHelpText="This page is session-only. Please complete wallet sign-in from Service Management, then return to deploy."
      sessionRecoveryHref="/dashboard/provider/nodes"
      sessionRecoveryLabel="Go to API Services"
    >
    <div className="h-[calc(100vh-80px)] flex flex-col md:flex-row bg-[#050505] overflow-hidden">
      {/* LEFT SIDE: BUILDER FORM */}
      <div className="w-full md:w-1/2 h-full overflow-y-auto border-r border-gray-800 p-8 hide-scrollbar">
        <div className="mb-6">
          <Link href="/dashboard/provider/nodes" className="inline-flex items-center text-gray-400 hover:text-green-400 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Link>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center">
                <Server className="w-6 h-6 mr-3 text-green-500" />
                Build Service Manifest
              </h1>
              <p className="text-gray-500 mt-2 text-sm">Design your AI-native API contract. Synapse Gateway will use this to route buyer requests and process zero-gas payments.</p>
            </div>
            {hasDraft && (
              <button 
                onClick={handleRestoreDraft}
                className="text-xs px-3 py-1.5 bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 rounded-lg hover:bg-yellow-500/30 transition shadow-sm whitespace-nowrap ml-4 flex-shrink-0"
              >
                导入未完成草稿
              </button>
            )}
          </div>
          
          <div className="mt-8">
             <div 
               className="bg-[#0a0a0a] rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between group hover:border-[#444444] transition-all cursor-pointer border border-[#222222] relative overflow-hidden" 
               onClick={() => setShowAIModal(true)}
             >
               <div className="absolute top-0 right-0 w-32 h-32 bg-[#ffffff] opacity-[0.02] blur-3xl rounded-full pointer-events-none group-hover:bg-[#22c55e] transition-colors duration-500" />
               <div className="mb-4 sm:mb-0 relative z-10">
                  <h3 className="text-white font-[800] tracking-tight flex items-center text-xl">
                    <TerminalSquare className="w-6 h-6 mr-3 text-[#86868b] group-hover:text-white transition-colors" />
                    AI Auto-Gen: 从 cURL 极速导入
                  </h3>
                  <p className="text-[#86868b] text-sm mt-2 ml-9 font-medium">自动解析接口、字段结构和推理路由，一键生成标准 Manifest</p>
               </div>
               <div className="relative z-10 flex items-center bg-white text-black text-sm font-bold px-6 py-3 rounded-xl hover:bg-[#22c55e] hover:shadow-[0_0_20px_rgba(34,197,94,0.3)] transition-all">
                  <Wand2 className="w-4 h-4 mr-2" />
                  Paste cURL
               </div>
             </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Section 1: AI Interface */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-gray-800 pb-2">1. Artificial Intelligence Interface</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Service Name (Human Readable)
                <FieldGuideHint fieldKey="service_name" />
              </label>
              <input 
                type="text" 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-green-500"
                placeholder="e.g. DeepSeek Market Analysis"
                value={manifest.service_name}
                onChange={(e) => handleUpdate("service_name", e.target.value)}
              />
              {fieldErrors.service_name ? (
                <p className="text-xs text-yellow-300 mt-1">{fieldErrors.service_name}</p>
              ) : (
                <p className="text-xs text-gray-600 mt-1">Keep it short, readable, and product-grade.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Agent Tool Name <span className="text-red-500">*</span>
                <FieldGuideHint fieldKey="agent_tool_name" />
              </label>
              <input 
                type="text" 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                placeholder="e.g. get_market_analysis"
                value={manifest.agent_tool_name}
                onChange={(e) => handleUpdate("agent_tool_name", e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              />
              {fieldErrors.agent_tool_name ? (
                <p className="text-xs text-yellow-300 mt-1">{fieldErrors.agent_tool_name}</p>
              ) : (
                <p className="text-xs text-gray-600 mt-1">Required. 3-64 chars, regex: ^[a-z0-9_-]+$</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Description (Trigger Condition)
                <FieldGuideHint fieldKey="description" />
              </label>
              <textarea 
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 h-24"
                placeholder="Give autonomous agents clear instructions on WHEN and WHY they should invoke this tool..."
                value={manifest.description}
                onChange={(e) => handleUpdate("description", e.target.value)}
              />
              {fieldErrors.description ? (
                <p className="text-xs text-yellow-300 mt-1">{fieldErrors.description}</p>
              ) : (
                <p className="text-xs text-gray-600 mt-1">Required. {AI_DESCRIPTION_MIN}-{AI_DESCRIPTION_MAX} chars.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Semantic Intents (Tags)
                <FieldGuideHint fieldKey="intent" />
              </label>
              <div className="flex gap-2 mb-2">
                <input 
                  type="text" 
                  className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
                  placeholder="e.g. crypto, weather, indexing"
                  value={intentInput}
                  onChange={(e) => setIntentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddIntent();
                    }
                  }}
                />
                <button onClick={handleAddIntent} className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700">Add</button>
              </div>
              {fieldErrors.intent ? (
                <p className="text-xs text-yellow-300 mb-2">{fieldErrors.intent}</p>
              ) : (
                <p className="text-xs text-gray-600 mb-2">Add 1-{AI_INTENT_MAX} tags, each [a-z0-9_-], 2-24 chars.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {manifest.intent.map((tag) => (
                  <span key={tag} className="px-3 py-1 bg-green-900/30 border border-green-500/30 text-green-400 text-xs rounded-full flex items-center">
                    {tag}
                    <button onClick={() => handleRemoveIntent(tag)} className="ml-2 text-green-600 hover:text-green-300">&times;</button>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Section 2: Economics and Routing */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-white border-b border-gray-800 pb-2">2. Routing & SLA Economics</h2>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Cluster Endpoint URLs (one per line)
                <FieldGuideHint fieldKey="cluster_targets" />
              </label>
              <textarea
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500 h-24"
                placeholder="http://127.0.0.1:8100/api/v1/quotes/famous/top3\nhttp://127.0.0.1:8101/api/v1/quotes/famous/top3"
                value={endpointTargetsInput}
                onChange={(e) => {
                  setEndpointTargetsInput(e.target.value);
                  const first = e.target.value
                    .split(/\r?\n/)
                    .map((item) => item.trim())
                    .find(Boolean);
                  if (first) {
                    handleUpdate("endpoint", first);
                  }
                }}
              />
              {fieldErrors.cluster_targets ? (
                <p className="text-xs text-yellow-300 mt-1">{fieldErrors.cluster_targets}</p>
              ) : (
                <p className="text-xs text-gray-600 mt-1">Platform routes across targets using weights (first target starts as primary).</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Health Check Path
                <FieldGuideHint fieldKey="health_check" />
              </label>
              <input
                type="text"
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                placeholder="/health"
                value={manifest.health_check}
                onChange={(e) => handleUpdate("health_check", e.target.value)}
              />
              {fieldErrors.health_check ? (
                <p className="text-xs text-yellow-300 mt-1">{fieldErrors.health_check}</p>
              ) : (
                <p className="text-xs text-gray-600 mt-1">Gateway probes each target using origin + this path.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Price / Call (USDC)
                  <FieldGuideHint fieldKey="pricing" />
                </label>
                <input 
                  type="number" 
                  step="0.001"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-green-400 font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.pricing.amount}
                  onChange={(e) => handleUpdate("pricing.amount", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Timeout (ms)
                  <FieldGuideHint fieldKey="timeout_ms" />
                </label>
                <input
                  type="number"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.constraints.timeout_ms}
                  onChange={(e) => handleUpdate("constraints.timeout_ms", Number.parseInt(e.target.value, 10) || 0)}
                />
                {fieldErrors.timeout_ms ? (
                  <p className="text-xs text-yellow-300 mt-1">{fieldErrors.timeout_ms}</p>
                ) : (
                  <p className="text-xs text-gray-600 mt-1">Platform cap: 300-15000 ms.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Max Response Bytes
                  <FieldGuideHint fieldKey="max_response_bytes" />
                </label>
                <input
                  type="number"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.constraints.max_response_bytes}
                  onChange={(e) => handleUpdate("constraints.max_response_bytes", Number.parseInt(e.target.value, 10) || 0)}
                />
                {fieldErrors.max_response_bytes ? (
                  <p className="text-xs text-yellow-300 mt-1">{fieldErrors.max_response_bytes}</p>
                ) : (
                  <p className="text-xs text-gray-600 mt-1">Platform cap: 256-1048576 bytes.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Max Request Bytes
                  <FieldGuideHint fieldKey="max_request_bytes" />
                </label>
                <input
                  type="number"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.constraints.max_request_bytes}
                  onChange={(e) => handleUpdate("constraints.max_request_bytes", Number.parseInt(e.target.value, 10) || 0)}
                />
                {fieldErrors.max_request_bytes ? (
                  <p className="text-xs text-yellow-300 mt-1">{fieldErrors.max_request_bytes}</p>
                ) : (
                  <p className="text-xs text-gray-600 mt-1">Platform cap: 256-262144 bytes.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Max QPS Rate Limit
                  <FieldGuideHint fieldKey="max_qps" />
                </label>
                <input 
                  type="number" 
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-green-500"
                  value={manifest.constraints.max_qps}
                  onChange={(e) => handleUpdate("constraints.max_qps", Number.parseInt(e.target.value, 10) || 0)}
                />
                {fieldErrors.max_qps ? (
                  <p className="text-xs text-yellow-300 mt-1">{fieldErrors.max_qps}</p>
                ) : (
                  <p className="text-xs text-gray-600 mt-1">Platform cap: 1-200 QPS.</p>
                )}
              </div>
            </div>
          </section>

          {/* Section 3: AI Schema Magic */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-800 pb-2">
              <h2 className="text-lg font-bold text-white">3. Data Schema</h2>              </div>
              <p className="text-xs text-gray-500">Define the JSON Schema that agents will use to parse arguments and responses. Generating via AI is recommended.</p>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Input Schema (JSON)
                <FieldGuideHint fieldKey="input_schema" />
              </label>
              <textarea 
                className="w-full px-4 py-2 bg-black border border-gray-800 rounded-lg text-gray-300 font-mono text-xs focus:outline-none focus:border-gray-600 h-32"
                value={JSON.stringify(manifest.input_schema, null, 2)}
                onChange={(e) => {
                  try { handleUpdate("input_schema", JSON.parse(e.target.value)); } catch { /* ignore parse error while typing */ }
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 mt-4">
                Output Schema (JSON)
                <FieldGuideHint fieldKey="output_schema" />
              </label>
              <textarea 
                className="w-full px-4 py-2 bg-black border border-gray-800 rounded-lg text-gray-300 font-mono text-xs focus:outline-none focus:border-gray-600 h-32"
                value={JSON.stringify(manifest.output_schema, null, 2)}
                onChange={(e) => {
                  try { handleUpdate("output_schema", JSON.parse(e.target.value)); } catch { /* ignore parse error while typing */ }
                }}
              />
            </div>
          </section>
          
          <div className="pt-6 border-t border-gray-800">
            <button
              onClick={submitDeploy}
              disabled={isDeploying || !manifest.agent_tool_name || parsedClusterTargets.length === 0 || aiInterfaceValidationErrors.length > 0}
              className="w-full py-3 font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
            >
              {isDeploying ? "DEPLOYING..." : "CONFIRM & DEPLOY"}
            </button>
          </div>

        </div>
      </div>

      {/* RIGHT SIDE: LIVE PREVIEW */}
      <div className="w-full md:w-1/2 h-full bg-[#0a0a0a] flex flex-col relative">
        <div className="p-3 border-b border-green-900/30 bg-black flex justify-between items-center">
          {/* AI Auto-Gen Modal */}
      {showAIModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0a] border border-green-900/50 rounded-xl w-full max-w-5xl shadow-[0_0_40px_rgba(34,197,94,0.1)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/40">
              <h3 className="text-xl font-bold text-white flex items-center">
                <Wand2 className="w-5 h-5 mr-2 text-purple-400" />
                AI API Parser
              </h3>
              <button onClick={() => setShowAIModal(false)} className="text-gray-400 hover:text-white p-2 hover:bg-gray-800 rounded-lg transition-colors flex items-center justify-center">
                 <X className="w-8 h-8" />
              </button>
            </div>
            <div className="p-6 space-y-4 flex-1 overflow-y-auto w-full">
              <p className="text-sm text-gray-400 mb-2">
                Paste your raw cURL command. Generate calls the real parser endpoint, uses AI to infer schema and routing, and auto-fills the form.
              </p>
              <p className="text-xs text-gray-500 -mt-2">
                Use Confirm Override only after manually editing the JSON on the right.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Raw cURL Command</label>
                  <textarea 
                    className="w-full px-4 py-3 bg-black border border-gray-700 rounded-lg text-green-400 font-mono text-xs focus:outline-none focus:border-green-500 h-[400px]"
                    placeholder="curl -X POST ..."
                    value={aiCurl}
                    onChange={(e) => setAICurl(e.target.value)}
                  />
                </div>

                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-300 mb-1 flex justify-between">
                     <span>Expected / Generated JSON Response</span>
                  </label>
                  <textarea 
                    className="w-full flex-1 px-4 py-3 bg-[#050505] border border-gray-700 rounded-lg text-blue-400 font-mono text-xs focus:outline-none focus:border-green-500 h-[400px]"
                    placeholder='{"status": "success"}'
                    value={aiResponse}
                    onChange={(e) => setAIResponse(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-6 border-t border-gray-800 mt-4">
                <div className="mr-auto">
                  {aiResponse.trim() && !parsedPreview ? (
                    <p className="text-xs text-red-300">JSON format invalid. Fix syntax before override.</p>
                  ) : (
                    <p className="text-xs text-gray-400">
                      Override preview: {overrideChanges.length} field{overrideChanges.length === 1 ? "" : "s"} will change.
                    </p>
                  )}
                  {overrideChanges.length > 0 && (
                    <p className="text-[11px] text-gray-500 mt-1 max-w-[520px] truncate">
                      {overrideChanges.slice(0, 6).join(" | ")}
                      {overrideChanges.length > 6 ? ` +${overrideChanges.length - 6} more` : ""}
                    </p>
                  )}
                </div>
                <button 
                  onClick={autofillAIMagic}
                  disabled={isAiGenerating || !aiCurl}
                    className="px-8 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors font-bold flex items-center justify-center disabled:opacity-50 min-w-[120px]"
                  >
                    {isAiGenerating ? <span className="animate-pulse">Generating...</span> : "Generate JSON"}
                  </button>
                  <button 
                    onClick={confirmAndInject}
                    disabled={!parsedPreview || isAiGenerating || overrideChanges.length === 0}
                    className="px-8 py-2 bg-green-500 hover:bg-green-400 text-black rounded-lg transition-colors font-bold flex items-center justify-center shadow-[0_0_15px_rgba(34,197,94,0.3)] min-w-[120px] disabled:opacity-50 disabled:shadow-none"
                  >
                    <Check className="w-5 h-5 mr-1" />
                    Confirm Override
                  </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
            <div className="text-xs text-green-400 font-mono tracking-wide flex items-center">
              <TerminalSquare className="w-4 h-4 mr-2" />
              LIVE MANIFEST PREVIEW
            </div>
            <span className={`text-[10px] px-2 py-1 rounded border font-semibold tracking-wide ${
              isManifestReady
                ? "text-green-300 border-green-500/40 bg-green-500/10"
                : "text-yellow-300 border-yellow-500/30 bg-yellow-500/10"
            }`}>
              {isManifestReady ? "Ready to Deploy" : `${completedChecks}/${readinessChecks.length} Required Fields`}
            </span>
          </div>
          <div className="flex space-x-2">
            <div className="w-3 h-3 rounded-full bg-red-600"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-600"></div>
            <div className="w-3 h-3 rounded-full bg-green-600"></div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 font-mono text-sm leading-relaxed hide-scrollbar relative">
          {/* Abstract Cyberpunk Grid Background */}
          <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(rgba(34,197,94,0.3)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.3)_1px,transparent_1px)] bg-[size:20px_20px]" />

          <div className="relative z-10 space-y-4">
            <div className="rounded-lg border border-gray-800 bg-black/60 p-3">
              <p className="text-xs text-gray-300">
                This is the final contract the gateway and AI buyers will read after deployment.
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                It updates in real-time while you edit the form on the left.
              </p>
            </div>

            <div className="rounded-lg border border-green-900/40 bg-black/70 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-300 font-semibold tracking-wide">Deployment Readiness</p>
                <p className={`text-xs font-semibold ${isManifestReady ? "text-green-300" : "text-yellow-300"}`}>
                  {readinessPercent}%
                </p>
              </div>
              <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-200 ${isManifestReady ? "bg-green-500" : "bg-yellow-400"}`}
                  style={{ width: `${readinessPercent}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {readinessChecks.map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      item.ok
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-gray-700 bg-gray-900/40 text-gray-500"
                    }`}
                  >
                    {item.ok ? "OK" : "Missing"} · {item.label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] mt-3">
                <div className="rounded-md border border-gray-800 bg-gray-900/40 p-2">
                  <p className="text-gray-500">Tool Name</p>
                  <p className="text-green-300 mt-1 break-all">{manifest.agent_tool_name || "Not set"}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-900/40 p-2">
                  <p className="text-gray-500">Price / Call</p>
                  <p className="text-gray-200 mt-1">{formattedPrice}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-900/40 p-2 col-span-2">
                  <p className="text-gray-500">Manifest Size</p>
                  <p className="text-gray-200 mt-1">{manifestBytes} bytes</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-green-900/40 bg-black/70 overflow-hidden">
              <div className="px-3 py-2 border-b border-green-900/30 text-[11px] text-gray-400">
                Manifest JSON Preview
              </div>
              <pre className="p-3 text-green-300 whitespace-pre-wrap overflow-x-auto text-xs leading-relaxed">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
          </div>
        </div>

        <div className="p-6 bg-black border-t border-green-900/30 mt-auto shadow-[0_-20px_40px_rgba(0,0,0,0.5)] z-10">
          <button
            onClick={submitDeploy}
            disabled={isDeploying || missingRequiredFields.length > 0 || aiInterfaceValidationErrors.length > 0}
            className="w-full py-4 font-bold text-black bg-green-500 rounded-lg hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
          >
            {isDeploying ? (
              <span className="animate-pulse">INJECTING TO MAINNET...</span>
            ) : aiInterfaceValidationErrors.length > 0 ? (
              <span>FIX AI INTERFACE VALIDATION RULES</span>
            ) : missingRequiredFields.length > 0 ? (
              <span>COMPLETE REQUIRED FIELDS TO DEPLOY</span>
            ) : (
              <span>DEPLOY MANIFEST</span>
            )}
          </button>
          {aiInterfaceValidationErrors.length > 0 ? (
            <p className="text-center text-[11px] text-yellow-300 mt-3">
              Validation: {aiInterfaceValidationErrors[0]}
            </p>
          ) : missingRequiredFields.length > 0 ? (
            <p className="text-center text-[11px] text-yellow-300 mt-3">
              Missing: {missingRequiredFields.join(" / ")}
            </p>
          ) : (
            <p className="text-center text-[11px] text-green-300 mt-3">
              Ready for deployment. Gateway contract checks passed.
            </p>
          )}
          <p className="text-center text-[10px] text-gray-600 mt-3 font-mono">
            By deploying, you accept the Seller Gateway ToS. Cost: 0 Gas (Off-chain injection).
          </p>
        </div>
      </div>
    </div>
    </AuthMask>
  );
}

