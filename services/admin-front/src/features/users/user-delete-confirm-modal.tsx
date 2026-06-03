"use client";

import { ConfirmActionModal } from "@/components/confirm-action-modal";
import type { AdminUserItem } from "@/services/admin-api";

export function UserDeleteConfirmModal({
  deletingAdminId,
  onCancel,
  onConfirm,
  user,
}: Readonly<{
  deletingAdminId: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  user: AdminUserItem | null;
}>) {
  return (
    <ConfirmActionModal
      open={user !== null}
      title="禁用管理员"
      description="禁用后该管理员将不能继续使用控制台，历史审计记录会被保留。"
      confirmLabel="确认禁用"
      contextLabel={user ? `${user.displayName} · ${user.email}` : undefined}
      tone="danger"
      loading={user !== null && deletingAdminId === user.adminId}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
