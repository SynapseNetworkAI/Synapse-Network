// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NotificationCenter from "@/components/NotificationCenter";

const {
  fetchUnreadNotificationCountMock,
  fetchNotificationsMock,
  markAllNotificationsReadMock,
  markNotificationReadMock,
  archiveNotificationMock,
} = vi.hoisted(() => ({
  fetchUnreadNotificationCountMock: vi.fn(),
  fetchNotificationsMock: vi.fn(),
  markAllNotificationsReadMock: vi.fn(),
  markNotificationReadMock: vi.fn(),
  archiveNotificationMock: vi.fn(),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0xabc", isConnected: true }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/i18n/LanguageProvider", () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        "nav.notifications": "Notifications",
        "nav.notificationSubtitle": "Wallet-scoped product inbox.",
        "nav.notificationsLoading": "Loading notifications...",
        "nav.notificationsEmpty": "No notifications yet.",
        "nav.notificationLoadFailed": "Failed to load notifications.",
        "nav.markAllRead": "Mark all read",
        "nav.openNotification": "Open",
        "nav.archiveNotification": "Archive notification",
      })[key] ?? key,
  }),
}));

vi.mock("@/utils/notificationsApi", () => ({
  fetchUnreadNotificationCount: fetchUnreadNotificationCountMock,
  fetchNotifications: fetchNotificationsMock,
  markAllNotificationsRead: markAllNotificationsReadMock,
  markNotificationRead: markNotificationReadMock,
  archiveNotification: archiveNotificationMock,
}));

const notification = {
  notificationId: "inapp-1",
  eventType: "consumer_withdrawal.created",
  category: "withdrawal",
  severity: "warning",
  priority: "transactional_high",
  title: "Consumer withdrawal created",
  body: "Withdrawal wd-1 is PENDING_MANUAL_REVIEW for 2.000000 USDC.",
  actionUrl: "/dashboard/billing/credits",
  resourceType: "consumer_withdrawal",
  resourceId: "wd-1",
  payload: { amount: "2.000000" },
  readAt: null,
  archivedAt: null,
  expiresAt: null,
  createdAt: new Date().toISOString(),
};

describe("NotificationCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadNotificationCountMock.mockResolvedValue(1);
    fetchNotificationsMock.mockResolvedValue({ notifications: [notification], nextCursor: null });
    markAllNotificationsReadMock.mockResolvedValue(1);
    markNotificationReadMock.mockResolvedValue(undefined);
    archiveNotificationMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows unread badge and loads notification list when opened", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter />);

    await waitFor(() => expect(fetchUnreadNotificationCountMock).toHaveBeenCalledWith("0xabc"));
    expect(await screen.findByText("1")).toBeTruthy();

    await user.click(screen.getByLabelText("Notifications"));

    expect(await screen.findByText("Consumer withdrawal created")).toBeTruthy();
    expect(screen.getByText(/PENDING_MANUAL_REVIEW/)).toBeTruthy();
  });

  it("pauses polling while the tab is hidden and refreshes when visible again", async () => {
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get");
    visibilitySpy.mockReturnValue("hidden");
    render(<NotificationCenter />);

    await Promise.resolve();
    expect(fetchUnreadNotificationCountMock).not.toHaveBeenCalled();

    visibilitySpy.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(fetchUnreadNotificationCountMock).toHaveBeenCalledTimes(1));
    visibilitySpy.mockRestore();
  });

  it("marks all notifications as read and archives a single notification", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter />);
    await user.click(screen.getByLabelText("Notifications"));
    await screen.findByText("Consumer withdrawal created");

    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(markAllNotificationsReadMock).toHaveBeenCalledWith("0xabc");

    await user.click(screen.getByLabelText("Archive notification"));
    expect(archiveNotificationMock).toHaveBeenCalledWith("0xabc", "inapp-1");
  });
});
