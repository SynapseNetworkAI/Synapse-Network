import { formatDateTime } from "@/lib/admin-console";
import type { ProviderServiceItem } from "@/services/admin-api";

export type ProviderServiceFilters = {
  query: string;
  submittedQuery: string;
  controlStatus: string;
  runtimeStatus: string;
};

export type ProviderServiceAction =
  | "probe"
  | "pause"
  | "resume"
  | "suspend"
  | "delete";

export type ProviderServiceLifecycleAction = "PAUSE" | "RESUME" | "SUSPEND";

export const PROVIDER_SERVICE_DEFAULT_FILTERS: ProviderServiceFilters = {
  query: "",
  submittedQuery: "",
  controlStatus: "all",
  runtimeStatus: "all",
};

export const PROVIDER_SERVICE_PAGE_SIZE_OPTIONS = [10, 20, 50];

export const PROVIDER_SERVICE_CONTROL_STATUS_OPTIONS = [
  { value: "active", label: "active" },
  { value: "inactive", label: "inactive" },
  { value: "suspended", label: "suspended" },
  { value: "draft", label: "draft" },
];

export const PROVIDER_SERVICE_RUNTIME_STATUS_OPTIONS = [
  { value: "healthy", label: "healthy" },
  { value: "degraded", label: "degraded" },
  { value: "unhealthy", label: "unhealthy" },
  { value: "stale", label: "stale" },
  { value: "unknown", label: "unknown" },
  { value: "inactive", label: "inactive" },
  { value: "suspended", label: "suspended" },
];

export function formatProviderServiceEpochMs(
  value: number | null | undefined
): string {
  if (!value) {
    return "n/a";
  }
  return formatDateTime(new Date(value).toISOString());
}

export function getProviderServiceTargetError(
  service: Pick<ProviderServiceItem, "targets">
): string {
  return (
    service.targets.find((target) => Boolean(target.error))?.error ??
    "无最近错误"
  );
}

export function buildProviderServiceListParams({
  filters,
  page,
  pageSize,
}: {
  filters: ProviderServiceFilters;
  page: number;
  pageSize: number;
}) {
  return {
    query: filters.submittedQuery || undefined,
    status: filters.controlStatus === "all" ? undefined : filters.controlStatus,
    runtimeStatus:
      filters.runtimeStatus === "all" ? undefined : filters.runtimeStatus,
    page,
    pageSize,
  };
}

export function resolveProviderServiceLifecycleAction(
  action: ProviderServiceAction
): ProviderServiceLifecycleAction | null {
  if (action === "pause") {
    return "PAUSE";
  }
  if (action === "resume") {
    return "RESUME";
  }
  if (action === "suspend") {
    return "SUSPEND";
  }
  return null;
}

export function buildProviderServiceLifecycleNote(
  lifecycleAction: ProviderServiceLifecycleAction
): string {
  return `${lifecycleAction} from provider service control plane.`;
}

export function buildProviderServiceActionNotice(
  service: Pick<ProviderServiceItem, "serviceName">,
  action: ProviderServiceAction
): string {
  if (action === "probe") {
    return `已触发 ${service.serviceName} 的即时探活。`;
  }
  if (action === "delete") {
    return `已逻辑删除 ${service.serviceName}。`;
  }

  const lifecycleAction = resolveProviderServiceLifecycleAction(action);
  return lifecycleAction
    ? `已执行 ${lifecycleAction}: ${service.serviceName}`
    : `已处理 ${service.serviceName}。`;
}

export function canDeleteProviderService(
  service: Pick<ProviderServiceItem, "controlStatus">
): boolean {
  return service.controlStatus !== "active";
}
