"use client";

import Link from "next/link";
import { Archive, Bell, CheckCheck, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import {
  archiveNotification,
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type InAppNotification,
} from "@/utils/notificationsApi";

const POLL_INTERVAL_MS = 45_000;

const severityClasses: Record<InAppNotification["severity"], string> = {
  info: "border-[#2f3336] bg-[#080808] text-[#e7e9ea]",
  success: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100",
  warning: "border-amber-500/24 bg-amber-500/[0.07] text-amber-100",
  critical: "border-red-500/24 bg-red-500/[0.08] text-red-100",
};

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export default function NotificationCenter() {
  const { address, isConnected } = useAccount();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const loadUnreadCount = useCallback(async () => {
    if (!address || !isConnected || document.visibilityState !== "visible" || !navigator.onLine) {
      return;
    }
    try {
      const nextCount = await fetchUnreadNotificationCount(address);
      setUnreadCount(nextCount);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("nav.notificationLoadFailed"));
    }
  }, [address, isConnected, t]);

  const loadNotifications = useCallback(async () => {
    if (!address || !isConnected) {
      return;
    }
    setLoading(true);
    try {
      const result = await fetchNotifications(address, { limit: 20 });
      setNotifications(result.notifications);
      setUnreadCount(result.notifications.filter((item) => !item.readAt).length);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("nav.notificationLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [address, isConnected, t]);

  useEffect(() => {
    void loadUnreadCount();
    const interval = globalThis.setInterval(() => {
      void loadUnreadCount();
    }, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadUnreadCount();
      }
    };
    const onOnline = () => {
      void loadUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    globalThis.addEventListener("online", onOnline);
    return () => {
      globalThis.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener("online", onOnline);
    };
  }, [loadUnreadCount]);

  useEffect(() => {
    if (open) {
      void loadNotifications();
    }
  }, [loadNotifications, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleMarkAllRead = async () => {
    if (!address) return;
    await markAllNotificationsRead(address);
    setNotifications((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })),
    );
    setUnreadCount(0);
  };

  const handleMarkRead = async (notification: InAppNotification) => {
    if (!address || notification.readAt) return;
    await markNotificationRead(address, notification.notificationId);
    setNotifications((current) =>
      current.map((item) =>
        item.notificationId === notification.notificationId
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
  };

  const handleArchive = async (notification: InAppNotification) => {
    if (!address) return;
    await archiveNotification(address, notification.notificationId);
    setNotifications((current) =>
      current.filter((item) => item.notificationId !== notification.notificationId),
    );
    if (!notification.readAt) {
      setUnreadCount((count) => Math.max(0, count - 1));
    }
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex items-center justify-center text-[#71767b] transition hover:text-[#e7e9ea]"
        aria-label={t("nav.notifications")}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 min-w-[18px] rounded-full bg-emerald-400 px-1.5 text-center text-[10px] font-bold leading-[18px] text-black">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-9 z-[70] w-[min(92vw,380px)] overflow-hidden rounded-[22px] border border-[#2f3336] bg-[#050505] shadow-[0_28px_90px_rgba(0,0,0,0.56)]">
          <div className="flex items-center justify-between border-b border-[#1d1f22] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#e7e9ea]">{t("nav.notifications")}</p>
              <p className="text-xs text-[#71767b]">{t("nav.notificationSubtitle")}</p>
            </div>
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#2f3336] px-2.5 py-1.5 text-xs font-semibold text-[#a8ffcf] transition hover:border-emerald-400/30 hover:bg-emerald-400/10"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("nav.markAllRead")}
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2">
            {loading ? (
              <p className="px-3 py-8 text-center text-sm text-[#71767b]">{t("nav.notificationsLoading")}</p>
            ) : error ? (
              <p className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-3 py-3 text-sm text-red-100">
                {error}
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-[#71767b]">{t("nav.notificationsEmpty")}</p>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => (
                  <article
                    key={notification.notificationId}
                    className={[
                      "rounded-[18px] border p-3",
                      severityClasses[notification.severity],
                      notification.readAt ? "opacity-70" : "shadow-[0_0_0_1px_rgba(127,247,190,0.08)]",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{notification.title}</p>
                        <p className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-[#a5a8ad]">
                          {notification.body}
                        </p>
                      </div>
                      {!notification.readAt ? (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                      ) : null}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[#71767b]">
                      <span>{formatRelativeTime(notification.createdAt)}</span>
                      <div className="flex items-center gap-2">
                        {notification.actionUrl ? (
                          <Link
                            href={notification.actionUrl}
                            onClick={() => {
                              void handleMarkRead(notification);
                              setOpen(false);
                            }}
                            className="inline-flex items-center gap-1 text-[#a8ffcf] hover:text-white"
                          >
                            {t("nav.openNotification")}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleArchive(notification)}
                          className="inline-flex items-center gap-1 hover:text-white"
                          aria-label={t("nav.archiveNotification")}
                        >
                          <Archive className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
