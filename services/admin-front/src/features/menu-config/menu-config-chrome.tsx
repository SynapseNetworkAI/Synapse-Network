"use client";

import { Button, Flex } from "@chakra-ui/react";

import { ConfirmActionModal } from "@/components/confirm-action-modal";
import { MessageBanner } from "@/components/console-ui";
import type { AdminMenuConfigItem } from "@/services/admin-api";

export function MenuConfigActions({
  canManage,
  onPublish,
  onCreate,
}: Readonly<{
  canManage: boolean;
  onPublish: () => void;
  onCreate: () => void;
}>) {
  if (!canManage) {
    return null;
  }
  return (
    <Flex gap="10px">
      <Button variant="outline" borderRadius="full" onClick={onPublish}>
        发布 published
      </Button>
      <Button
        borderRadius="full"
        bg="brand.500"
        color="white"
        _hover={{ bg: "brand.600" }}
        onClick={onCreate}
      >
        创建菜单项
      </Button>
    </Flex>
  );
}

export function MenuConfigNotices({
  message,
  error,
}: Readonly<{ message: string | null; error: string | null }>) {
  return (
    <>
      {message ? <MessageBanner kind="success" message={message} /> : null}
      {error ? <MessageBanner kind="error" message={error} /> : null}
    </>
  );
}

export function MenuDeleteConfirmModal({
  row,
  deletingItemId,
  onCancel,
  onConfirm,
}: Readonly<{
  row: AdminMenuConfigItem | null;
  deletingItemId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  return (
    <ConfirmActionModal
      open={row !== null}
      title="删除菜单项"
      description={row ? `确认删除菜单项 ${row.label} 吗？` : ""}
      contextLabel={row?.itemId}
      confirmLabel="确认删除"
      tone="danger"
      loading={row !== null && deletingItemId === row.itemId}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
