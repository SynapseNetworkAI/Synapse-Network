import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AdminNotification } from "@/services/admin-api";

import { AdminNotificationInbox } from "./admin-notification-inbox";
import {
  archiveAdminInboxNotification,
  formatNotificationTime,
  loadAdminInboxNotifications,
  markAdminNotificationsReadLocally,
  markAllAdminInboxNotificationsRead,
  openAdminInboxNotification,
  refreshAdminInboxCount,
  removeAdminNotificationById,
  resolveAdminNotificationUnreadLabel,
  severityStyles,
} from "./admin-notification-inbox-logic";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/services/admin-api", () => ({
  archiveAdminNotification: vi.fn(),
  getAdminNotificationUnreadCount: vi.fn(),
  listAdminNotifications: vi.fn(),
  markAdminNotificationRead: vi.fn(),
  markAllAdminNotificationsRead: vi.fn(),
}));

vi.mock("@chakra-ui/react", () => {
  const element = (tag: string, displayName: string) => {
    const MockComponent = ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => React.createElement(tag, props, children);
    MockComponent.displayName = displayName;
    return MockComponent;
  };
  return {
    Badge: element("span", "MockBadge"),
    Box: element("div", "MockBox"),
    Button: element("button", "MockButton"),
    HStack: element("div", "MockHStack"),
    Stack: element("div", "MockStack"),
    Text: element("span", "MockText"),
  };
});

function notification(
  override: Partial<AdminNotification> = {}
): AdminNotification {
  return {
    notificationId: "notif_provider_pause",
    eventType: "admin.provider_service.pause",
    category: "service",
    severity: "warning",
    priority: "ops",
    title: "Provider service pause submitted",
    body: "Synapse Mock Cost is now inactive. Review the service record if follow-up is needed.",
    actionUrl: "/provider-services?serviceId=svc_synapse_mock_cost_1usdc",
    resourceType: "provider_service",
    resourceId: "svc_synapse_mock_cost_1usdc",
    payload: {
      serviceId: "svc_synapse_mock_cost_1usdc",
      action: "PAUSE",
    },
    readAt: null,
    archivedAt: null,
    createdAt: "2026-05-08T00:00:00Z",
    ...override,
  };
}

describe("AdminNotificationInbox", () => {
  it("renders a real notification entrypoint without leaking implementation details", () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminNotificationInbox)
    );

    expect(html).toContain("通知");
    expect(html).not.toContain("synapse_in_app_notifications");
    expect(html).not.toContain("HTTPException");
    expect(html).not.toContain("RPC");
    expect(html).not.toContain("backend");
  });

  it("renders unread inbox DOM, actions, and business-readable notification copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminNotificationInbox, {
        initialOpenForTest: true,
        initialUnreadCountForTest: 2,
        skipInitialFetchForTest: true,
        initialNotificationsForTest: [notification()],
      })
    );

    expect(html).toContain("2");
    expect(html).toContain("Admin Inbox");
    expect(html).toContain("Provider service pause submitted");
    expect(html).toContain("Synapse Mock Cost is now inactive");
    expect(html).toContain("warning");
    expect(html).toContain("查看");
    expect(html).toContain("归档");
    expect(html).toContain("全部已读");
    expect(html).not.toContain("synapse_in_app_notifications");
    expect(html).not.toContain("HTTPException");
    expect(html).not.toContain("CHAIN_RPC");
    expect(html).not.toContain("backend");
    expect(html).not.toContain("ledger");
    expect(html).not.toContain("SQL");
  });

  it("renders empty, read, and severity fallback states without raw internal copy", () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(AdminNotificationInbox, {
        initialOpenForTest: true,
        skipInitialFetchForTest: true,
      })
    );

    expect(emptyHtml).toContain("暂无待处理通知");
    expect(emptyHtml).toContain("有需要跟进的后台事项时会出现在这里");

    const richHtml = renderToStaticMarkup(
      React.createElement(AdminNotificationInbox, {
        initialOpenForTest: true,
        initialUnreadCountForTest: 120,
        skipInitialFetchForTest: true,
        initialNotificationsForTest: [
          notification({
            notificationId: "critical",
            severity: "critical",
            title: "Critical service needs attention",
            createdAt: null,
          }),
          notification({
            notificationId: "success",
            severity: "success",
            title: "Service action completed",
            actionUrl: null,
            readAt: "2026-05-08T01:00:00Z",
            createdAt: "not-a-date",
          }),
          notification({
            notificationId: "info",
            severity: "info",
            title: "Service note",
            actionUrl: null,
          }),
        ],
      })
    );

    expect(richHtml).toContain("99+");
    expect(richHtml).toContain("critical");
    expect(richHtml).toContain("success");
    expect(richHtml).toContain("info");
    expect(richHtml).toContain("Critical service needs attention");
    expect(richHtml).toContain("Service action completed");
    expect(richHtml).toContain("标记已读");
    expect(richHtml).toContain("just now");
    expect(richHtml).not.toContain("synapse_in_app_notifications");
    expect(richHtml).not.toContain("HTTPException");
    expect(richHtml).not.toContain("backend");
  });

  it("resolves inbox display helpers and local notification updates", () => {
    expect(resolveAdminNotificationUnreadLabel(0)).toBe("0");
    expect(resolveAdminNotificationUnreadLabel(100)).toBe("99+");
    expect(formatNotificationTime(null)).toBe("just now");
    expect(formatNotificationTime("not-a-date")).toBe("just now");
    expect(formatNotificationTime("2026-05-08T00:00:00Z")).not.toBe("just now");

    expect(severityStyles("critical").color).toBe("#a32020");
    expect(severityStyles("warning").color).toBe("#a44d15");
    expect(severityStyles("success").color).toBe("#176a42");
    expect(severityStyles("info").color).toBe("#24547f");

    const unread = notification({ notificationId: "unread" });
    const read = notification({
      notificationId: "read",
      readAt: "2026-05-08T00:00:00Z",
    });
    expect(removeAdminNotificationById([unread, read], "unread")).toEqual([
      read,
    ]);
    expect(
      markAdminNotificationsReadLocally([unread, read], () => "now")
    ).toEqual([{ ...unread, readAt: "now" }, read]);
  });

  it("runs count and list helpers through success and failure paths", async () => {
    const countValues: number[] = [];
    await refreshAdminInboxCount({
      fetchUnreadCount: async () => ({ unreadCount: 3 }),
      onUnreadCount: (value) => countValues.push(value),
    });
    await refreshAdminInboxCount({
      fetchUnreadCount: async () => {
        throw new Error("network down");
      },
      onUnreadCount: (value) => countValues.push(value),
    });
    expect(countValues).toEqual([3, 0]);

    const loadingValues: boolean[] = [];
    const errors: Array<string | null> = [];
    const notifications: AdminNotification[][] = [];
    const refreshCount = vi.fn().mockResolvedValue(undefined);
    await loadAdminInboxNotifications({
      fetchNotifications: async () => ({ notifications: [notification()] }),
      onError: (value) => errors.push(value),
      onLoading: (value) => loadingValues.push(value),
      onNotifications: (value) => notifications.push(value),
      refreshCount,
    });
    await loadAdminInboxNotifications({
      fetchNotifications: async () => {
        throw new Error("raw backend stack");
      },
      onError: (value) => errors.push(value),
      onLoading: (value) => loadingValues.push(value),
      onNotifications: (value) => notifications.push(value),
      refreshCount,
    });

    expect(loadingValues).toEqual([true, false, true, false]);
    expect(errors).toContain(null);
    expect(errors).toContain("通知暂时无法加载，请稍后重试。");
    expect(notifications).toEqual([[notification()]]);
    expect(refreshCount).toHaveBeenCalledTimes(1);
  });

  it("runs read, archive, and mark-all helpers without exposing raw errors", async () => {
    const refreshCount = vi.fn().mockResolvedValue(undefined);
    const markRead = vi.fn().mockResolvedValue({});
    const navigate = vi.fn();
    const closeInbox = vi.fn();
    await openAdminInboxNotification({
      closeInbox,
      item: notification(),
      markRead,
      navigate,
      refreshCount,
    });
    expect(markRead).toHaveBeenCalledWith("notif_provider_pause");
    expect(refreshCount).toHaveBeenCalledTimes(1);
    expect(closeInbox).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      "/provider-services?serviceId=svc_synapse_mock_cost_1usdc"
    );

    await openAdminInboxNotification({
      closeInbox,
      item: notification({ actionUrl: null, readAt: "2026-05-08T00:00:00Z" }),
      markRead,
      navigate,
      refreshCount,
    });
    expect(markRead).toHaveBeenCalledTimes(1);

    const archive = vi.fn().mockResolvedValue({});
    const notificationUpdates: Array<
      (current: AdminNotification[]) => AdminNotification[]
    > = [];
    await archiveAdminInboxNotification({
      archive,
      item: notification(),
      onNotifications: (update) => notificationUpdates.push(update),
      refreshCount,
    });
    expect(archive).toHaveBeenCalledWith("notif_provider_pause");
    expect(notificationUpdates[0]([notification()])).toEqual([]);

    const markAllRead = vi.fn().mockResolvedValue({});
    await markAllAdminInboxNotificationsRead({
      markAllRead,
      now: () => "now",
      onNotifications: (update) => notificationUpdates.push(update),
      refreshCount,
    });
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(notificationUpdates[1]([notification()])).toEqual([
      { ...notification(), readAt: "now" },
    ]);
  });
});
