import { buildAuthedHeaders, normalizeAuthApiError } from "@/utils/authSession";
import { getGatewayBaseUrl } from "@/utils/gatewayApi";

export type InAppNotification = {
  notificationId: string;
  eventType: string;
  category: "finance" | "withdrawal" | "deposit" | "refund" | "security" | "service" | "approval" | "system";
  severity: "info" | "success" | "warning" | "critical";
  priority: "security" | "transactional_high" | "transactional" | "ops" | "digest";
  title: string;
  body: string;
  actionUrl: string | null;
  resourceType: string | null;
  resourceId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  archivedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type NotificationListResponse = {
  notifications: InAppNotification[];
  nextCursor: string | null;
};

const NOTIFICATIONS_API_BASE = `${getGatewayBaseUrl()}/api/v1/notifications`;

async function parseResponseError(response: Response): Promise<Error> {
  let message = "Notification request failed";
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    message = typeof detail === "string" ? detail : String(detail?.message || message);
  } catch {
    const text = await response.text();
    if (text) {
      message = text;
    }
  }
  return new Error(normalizeAuthApiError(message, response.status));
}

export async function fetchUnreadNotificationCount(ownerAddress: string): Promise<number> {
  const response = await fetch(`${NOTIFICATIONS_API_BASE}/unread-count`, {
    headers: buildAuthedHeaders(ownerAddress, false),
  });
  if (!response.ok) {
    throw await parseResponseError(response);
  }
  const payload = (await response.json()) as { unreadCount?: number };
  return Number(payload.unreadCount || 0);
}

export async function fetchNotifications(
  ownerAddress: string,
  options: { limit?: number; cursor?: string | null; unreadOnly?: boolean } = {},
): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 20));
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.unreadOnly) {
    params.set("unreadOnly", "true");
  }
  const response = await fetch(`${NOTIFICATIONS_API_BASE}?${params.toString()}`, {
    headers: buildAuthedHeaders(ownerAddress, false),
  });
  if (!response.ok) {
    throw await parseResponseError(response);
  }
  const payload = (await response.json()) as NotificationListResponse;
  return {
    notifications: Array.isArray(payload.notifications) ? payload.notifications : [],
    nextCursor: payload.nextCursor ?? null,
  };
}

export async function markNotificationRead(ownerAddress: string, notificationId: string): Promise<void> {
  const response = await fetch(`${NOTIFICATIONS_API_BASE}/${encodeURIComponent(notificationId)}/read`, {
    method: "POST",
    headers: buildAuthedHeaders(ownerAddress, false),
  });
  if (!response.ok) {
    throw await parseResponseError(response);
  }
}

export async function markAllNotificationsRead(ownerAddress: string): Promise<number> {
  const response = await fetch(`${NOTIFICATIONS_API_BASE}/mark-all-read`, {
    method: "POST",
    headers: buildAuthedHeaders(ownerAddress, false),
  });
  if (!response.ok) {
    throw await parseResponseError(response);
  }
  const payload = (await response.json()) as { updated?: number };
  return Number(payload.updated || 0);
}

export async function archiveNotification(ownerAddress: string, notificationId: string): Promise<void> {
  const response = await fetch(`${NOTIFICATIONS_API_BASE}/${encodeURIComponent(notificationId)}/archive`, {
    method: "POST",
    headers: buildAuthedHeaders(ownerAddress, false),
  });
  if (!response.ok) {
    throw await parseResponseError(response);
  }
}
