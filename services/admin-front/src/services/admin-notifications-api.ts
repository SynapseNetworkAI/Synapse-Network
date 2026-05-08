import { buildPath, request } from "./admin-api";

export type AdminNotification = {
  notificationId: string;
  eventType: string;
  category: string;
  severity: "info" | "success" | "warning" | "critical" | string;
  priority: string;
  title: string;
  body: string;
  actionUrl: string | null;
  resourceType: string | null;
  resourceId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string | null;
};

export type AdminNotificationListResponse = {
  notifications: AdminNotification[];
};

export type AdminNotificationUnreadCountResponse = {
  unreadCount: number;
};

export async function listAdminNotifications(
  _sessionToken: string,
  params?: { limit?: number; unreadOnly?: boolean }
): Promise<AdminNotificationListResponse> {
  return request<AdminNotificationListResponse>(
    buildPath("/api/admin/v1/notifications", params)
  );
}

export async function getAdminNotificationUnreadCount(
  _sessionToken: string
): Promise<AdminNotificationUnreadCountResponse> {
  return request<AdminNotificationUnreadCountResponse>(
    "/api/admin/v1/notifications/unread-count"
  );
}

export async function markAdminNotificationRead(
  _sessionToken: string,
  notificationId: string
): Promise<{ notificationId: string; read: boolean }> {
  return request<{ notificationId: string; read: boolean }>(
    `/api/admin/v1/notifications/${notificationId}/read`,
    { method: "POST" }
  );
}

export async function markAllAdminNotificationsRead(
  _sessionToken: string
): Promise<{ markedCount: number }> {
  return request<{ markedCount: number }>(
    "/api/admin/v1/notifications/mark-all-read",
    { method: "POST" }
  );
}

export async function archiveAdminNotification(
  _sessionToken: string,
  notificationId: string
): Promise<{ notificationId: string; archived: boolean }> {
  return request<{ notificationId: string; archived: boolean }>(
    `/api/admin/v1/notifications/${notificationId}/archive`,
    { method: "POST" }
  );
}
