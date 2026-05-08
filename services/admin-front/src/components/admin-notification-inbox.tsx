"use client";

import { Badge, Box, Button, HStack, Stack, Text } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  archiveAdminNotification,
  getAdminNotificationUnreadCount,
  listAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  type AdminNotification,
} from "@/services/admin-api";
import {
  archiveAdminInboxNotification,
  formatNotificationTime,
  loadAdminInboxNotifications,
  markAllAdminInboxNotificationsRead,
  openAdminInboxNotification,
  refreshAdminInboxCount,
  resolveAdminNotificationUnreadLabel,
  severityStyles,
} from "./admin-notification-inbox-logic";

const ADMIN_SESSION_TOKEN = "cookie-session";

type AdminNotificationInboxProps = {
  initialOpenForTest?: boolean;
  initialUnreadCountForTest?: number;
  initialNotificationsForTest?: AdminNotification[];
  skipInitialFetchForTest?: boolean;
};

type InboxToggleProps = {
  hasUnread: boolean;
  unreadLabel: string;
  onClick: () => void;
};

type InboxPopoverProps = {
  loading: boolean;
  error: string | null;
  hasUnread: boolean;
  notifications: AdminNotification[];
  onArchive: (item: AdminNotification) => void;
  onClose: () => void;
  onMarkAllRead: () => void;
  onOpenNotification: (item: AdminNotification) => void;
  onRefresh: () => void;
};

function InboxToggle({ hasUnread, unreadLabel, onClick }: InboxToggleProps) {
  return (
    <Button variant="ghost" borderRadius="full" onClick={onClick}>
      通知
      {hasUnread ? (
        <Badge ml="6px" borderRadius="full" bg="#1f9257" color="white" px="7px">
          {unreadLabel}
        </Badge>
      ) : null}
    </Button>
  );
}

function InboxHeader({ onClose }: { onClose: () => void }) {
  return (
    <HStack justify="space-between" align="start" mb="12px">
      <Stack gap="2px">
        <Text fontWeight="800">Admin Inbox</Text>
        <Text fontSize="12px" color="ink.500">
          需要后台跟进的服务、审核和系统事项。
        </Text>
      </Stack>
      <Button size="sm" variant="ghost" onClick={onClose}>
        关闭
      </Button>
    </HStack>
  );
}

function InboxActions({
  hasUnread,
  onMarkAllRead,
  onRefresh,
}: {
  hasUnread: boolean;
  onMarkAllRead: () => void;
  onRefresh: () => void;
}) {
  return (
    <HStack justify="space-between" mb="12px">
      <Button
        size="sm"
        variant="outline"
        borderRadius="full"
        onClick={onRefresh}
      >
        刷新
      </Button>
      <Button
        size="sm"
        variant="outline"
        borderRadius="full"
        onClick={onMarkAllRead}
        disabled={!hasUnread}
      >
        全部已读
      </Button>
    </HStack>
  );
}

function InboxState({
  error,
  loading,
  notifications,
}: {
  error: string | null;
  loading: boolean;
  notifications: AdminNotification[];
}) {
  if (loading) {
    return <Text color="ink.500">正在加载通知...</Text>;
  }
  if (error) {
    return <Text color="#a32020">{error}</Text>;
  }
  if (notifications.length > 0) {
    return null;
  }
  return (
    <Box
      borderRadius="18px"
      border="1px solid rgba(15,17,21,0.08)"
      p="18px"
      bg="#f7f9fc"
    >
      <Text fontWeight="700">暂无待处理通知</Text>
      <Text fontSize="13px" color="ink.500">
        有需要跟进的后台事项时会出现在这里。
      </Text>
    </Box>
  );
}

function NotificationCard({
  item,
  onArchive,
  onOpenNotification,
}: {
  item: AdminNotification;
  onArchive: (item: AdminNotification) => void;
  onOpenNotification: (item: AdminNotification) => void;
}) {
  const styles = severityStyles(item.severity);
  return (
    <Box
      border="1px solid rgba(15,17,21,0.08)"
      borderRadius="18px"
      p="12px"
      bg={item.readAt ? "#ffffff" : "#f7fbf8"}
    >
      <HStack justify="space-between" align="start" gap="8px">
        <Badge borderRadius="full" px="8px" py="4px" {...styles}>
          {item.severity}
        </Badge>
        <Text fontSize="12px" color="ink.500">
          {formatNotificationTime(item.createdAt)}
        </Text>
      </HStack>
      <Text mt="8px" fontWeight="800">
        {item.title}
      </Text>
      <Text mt="4px" fontSize="13px" color="ink.600">
        {item.body}
      </Text>
      <HStack mt="10px" justify="space-between">
        <Button
          size="sm"
          borderRadius="full"
          onClick={() => onOpenNotification(item)}
        >
          {item.actionUrl ? "查看" : "标记已读"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          color="#a32020"
          onClick={() => onArchive(item)}
        >
          归档
        </Button>
      </HStack>
    </Box>
  );
}

function NotificationList({
  notifications,
  onArchive,
  onOpenNotification,
}: {
  notifications: AdminNotification[];
  onArchive: (item: AdminNotification) => void;
  onOpenNotification: (item: AdminNotification) => void;
}) {
  return (
    <Stack gap="10px">
      {notifications.map((item) => (
        <NotificationCard
          key={item.notificationId}
          item={item}
          onArchive={onArchive}
          onOpenNotification={onOpenNotification}
        />
      ))}
    </Stack>
  );
}

function InboxPopover({
  loading,
  error,
  hasUnread,
  notifications,
  onArchive,
  onClose,
  onMarkAllRead,
  onOpenNotification,
  onRefresh,
}: InboxPopoverProps) {
  return (
    <Box
      position="absolute"
      right="0"
      top="48px"
      w={{ base: "calc(100vw - 32px)", md: "420px" }}
      maxH="560px"
      overflowY="auto"
      zIndex={30}
      bg="white"
      border="1px solid rgba(15,17,21,0.10)"
      borderRadius="24px"
      boxShadow="0 24px 80px rgba(15,17,21,0.18)"
      p="16px"
    >
      <InboxHeader onClose={onClose} />
      <InboxActions
        hasUnread={hasUnread}
        onMarkAllRead={onMarkAllRead}
        onRefresh={onRefresh}
      />
      <InboxState
        error={error}
        loading={loading}
        notifications={notifications}
      />
      <NotificationList
        notifications={notifications}
        onArchive={onArchive}
        onOpenNotification={onOpenNotification}
      />
    </Box>
  );
}

export function AdminNotificationInbox({
  initialOpenForTest = false,
  initialUnreadCountForTest = 0,
  initialNotificationsForTest = [],
  skipInitialFetchForTest = false,
}: AdminNotificationInboxProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpenForTest);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCountForTest);
  const [notifications, setNotifications] = useState<AdminNotification[]>(
    initialNotificationsForTest
  );
  const hasUnread = unreadCount > 0;
  const unreadLabel = useMemo(
    () => resolveAdminNotificationUnreadLabel(unreadCount),
    [unreadCount]
  );

  async function refreshCount() {
    await refreshAdminInboxCount({
      fetchUnreadCount: () =>
        getAdminNotificationUnreadCount(ADMIN_SESSION_TOKEN),
      onUnreadCount: setUnreadCount,
    });
  }

  async function loadNotifications() {
    await loadAdminInboxNotifications({
      fetchNotifications: () =>
        listAdminNotifications(ADMIN_SESSION_TOKEN, {
          limit: 20,
        }),
      onError: setError,
      onLoading: setLoading,
      onNotifications: setNotifications,
      refreshCount,
    });
  }

  useEffect(() => {
    if (skipInitialFetchForTest) {
      return;
    }
    void refreshCount();
  }, [skipInitialFetchForTest]);

  async function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      await loadNotifications();
    }
  }

  async function handleOpenNotification(item: AdminNotification) {
    await openAdminInboxNotification({
      closeInbox: () => setOpen(false),
      item,
      markRead: (notificationId) =>
        markAdminNotificationRead(ADMIN_SESSION_TOKEN, notificationId),
      navigate: (actionUrl) => router.push(actionUrl),
      refreshCount,
    });
  }

  async function handleArchive(item: AdminNotification) {
    await archiveAdminInboxNotification({
      archive: (notificationId) =>
        archiveAdminNotification(ADMIN_SESSION_TOKEN, notificationId),
      item,
      onNotifications: setNotifications,
      refreshCount,
    });
  }

  async function handleMarkAllRead() {
    await markAllAdminInboxNotificationsRead({
      markAllRead: () => markAllAdminNotificationsRead(ADMIN_SESSION_TOKEN),
      onNotifications: setNotifications,
      refreshCount,
    });
  }

  return (
    <Box position="relative">
      <InboxToggle
        hasUnread={hasUnread}
        unreadLabel={unreadLabel}
        onClick={() => {
          void toggleOpen();
        }}
      />
      {open ? (
        <InboxPopover
          error={error}
          hasUnread={hasUnread}
          loading={loading}
          notifications={notifications}
          onArchive={(item) => {
            void handleArchive(item);
          }}
          onClose={() => setOpen(false)}
          onMarkAllRead={() => {
            void handleMarkAllRead();
          }}
          onOpenNotification={(item) => {
            void handleOpenNotification(item);
          }}
          onRefresh={() => {
            void loadNotifications();
          }}
        />
      ) : null}
    </Box>
  );
}
