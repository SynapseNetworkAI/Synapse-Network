import type { AdminNotification } from "@/services/admin-api";

export function formatNotificationTime(value: string | null): string {
  if (!value) {
    return "just now";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function severityStyles(severity: string): {
  bg: string;
  color: string;
  border: string;
} {
  if (severity === "critical") {
    return {
      bg: "rgba(210,52,52,0.12)",
      color: "#a32020",
      border: "1px solid rgba(210,52,52,0.22)",
    };
  }
  if (severity === "warning") {
    return {
      bg: "rgba(194,101,32,0.12)",
      color: "#a44d15",
      border: "1px solid rgba(194,101,32,0.24)",
    };
  }
  if (severity === "success") {
    return {
      bg: "rgba(31,146,87,0.12)",
      color: "#176a42",
      border: "1px solid rgba(31,146,87,0.22)",
    };
  }
  return {
    bg: "rgba(31,91,146,0.10)",
    color: "#24547f",
    border: "1px solid rgba(31,91,146,0.18)",
  };
}

export function resolveAdminNotificationUnreadLabel(unreadCount: number) {
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function removeAdminNotificationById(
  notifications: AdminNotification[],
  notificationId: string
) {
  return notifications.filter((row) => row.notificationId !== notificationId);
}

export function markAdminNotificationsReadLocally(
  notifications: AdminNotification[],
  now: () => string = () => new Date().toISOString()
) {
  return notifications.map((row) => ({
    ...row,
    readAt: row.readAt ?? now(),
  }));
}

export async function refreshAdminInboxCount({
  fetchUnreadCount,
  onUnreadCount,
}: {
  fetchUnreadCount: () => Promise<{ unreadCount: number }>;
  onUnreadCount: (value: number) => void;
}) {
  try {
    const response = await fetchUnreadCount();
    onUnreadCount(response.unreadCount);
  } catch {
    onUnreadCount(0);
  }
}

export async function loadAdminInboxNotifications({
  fetchNotifications,
  onError,
  onLoading,
  onNotifications,
  refreshCount,
}: {
  fetchNotifications: () => Promise<{ notifications: AdminNotification[] }>;
  onError: (value: string | null) => void;
  onLoading: (value: boolean) => void;
  onNotifications: (value: AdminNotification[]) => void;
  refreshCount: () => Promise<void>;
}) {
  onLoading(true);
  onError(null);
  try {
    const response = await fetchNotifications();
    onNotifications(response.notifications);
    await refreshCount();
  } catch {
    onError("通知暂时无法加载，请稍后重试。");
  } finally {
    onLoading(false);
  }
}

export async function openAdminInboxNotification({
  closeInbox,
  item,
  markRead,
  navigate,
  refreshCount,
}: {
  closeInbox: () => void;
  item: AdminNotification;
  markRead: (notificationId: string) => Promise<unknown>;
  navigate: (actionUrl: string) => void;
  refreshCount: () => Promise<void>;
}) {
  if (!item.readAt) {
    await markRead(item.notificationId);
  }
  await refreshCount();
  if (item.actionUrl) {
    closeInbox();
    navigate(item.actionUrl);
  }
}

export async function archiveAdminInboxNotification({
  archive,
  item,
  onNotifications,
  refreshCount,
}: {
  archive: (notificationId: string) => Promise<unknown>;
  item: AdminNotification;
  onNotifications: (
    update: (current: AdminNotification[]) => AdminNotification[]
  ) => void;
  refreshCount: () => Promise<void>;
}) {
  await archive(item.notificationId);
  onNotifications((current) =>
    removeAdminNotificationById(current, item.notificationId)
  );
  await refreshCount();
}

export async function markAllAdminInboxNotificationsRead({
  markAllRead,
  now,
  onNotifications,
  refreshCount,
}: {
  markAllRead: () => Promise<unknown>;
  now?: () => string;
  onNotifications: (
    update: (current: AdminNotification[]) => AdminNotification[]
  ) => void;
  refreshCount: () => Promise<void>;
}) {
  await markAllRead();
  onNotifications((current) => markAdminNotificationsReadLocally(current, now));
  await refreshCount();
}
