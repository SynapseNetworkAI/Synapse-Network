export const PROVIDER_SERVICE_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  PAUSED: "paused",
  SUSPENDED: "suspended",
  DRAFT: "draft",
  DELETED: "deleted",
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
  STALE: "stale",
  UNKNOWN: "unknown",
} as const;

export type ProviderServiceStatus =
  typeof PROVIDER_SERVICE_STATUS[keyof typeof PROVIDER_SERVICE_STATUS];

const PROVIDER_SERVICE_STATUS_VALUES = Object.values(PROVIDER_SERVICE_STATUS) as ProviderServiceStatus[];

export function isProviderServiceStatus(value: unknown): value is ProviderServiceStatus {
  return typeof value === "string" && PROVIDER_SERVICE_STATUS_VALUES.includes(value as ProviderServiceStatus);
}

export function parseProviderServiceStatus(value: string): ProviderServiceStatus | null {
  return isProviderServiceStatus(value) ? value : null;
}

export function assertProviderServiceStatus(value: string): ProviderServiceStatus {
  const parsed = parseProviderServiceStatus(value);
  if (!parsed) {
    throw new Error(`Unknown provider service status: ${value}`);
  }
  return parsed;
}
