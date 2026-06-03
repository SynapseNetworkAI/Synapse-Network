"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import {
  createAdminMenuItem,
  deleteAdminMenuItem,
  publishAdminMenuConfig,
  updateAdminMenuItem,
  type AdminMenuConfigItem,
} from "@/services/admin-api";

import {
  buildCreateMenuItemPayload,
  buildMenuItemDraftPayload,
} from "./menu-config-form";
import type { useMenuItemEditor } from "./menu-config-state";
import type { useMenuConfigDraft } from "./use-menu-config-draft";

type StepUpRequester = (request: {
  title: string;
  description: string;
  confirmLabel: string;
}) => Promise<string | undefined>;

export function useMenuConfigMutations({
  token,
  canManage,
  draft,
  editor,
  requestStepUpCode,
}: Readonly<{
  token: string | null;
  canManage: boolean;
  draft: ReturnType<typeof useMenuConfigDraft>;
  editor: ReturnType<typeof useMenuItemEditor>;
  requestStepUpCode: StepUpRequester;
}>) {
  const [pendingDeleteRow, setPendingDeleteRow] =
    useState<AdminMenuConfigItem | null>(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      draft.setError("Missing admin token");
      return;
    }
    draft.clearNotices();
    try {
      const response = editor.editingRow
        ? await updateAdminMenuItem(
            token,
            editor.editingRow.itemId,
            buildMenuItemDraftPayload(editor.form)
          )
        : await createAdminMenuItem(
            token,
            buildCreateMenuItemPayload(editor.form)
          );
      draft.applyResponse(response);
      draft.setMessage(
        editor.editingRow ? "菜单项草稿已更新。" : "菜单项草稿已创建。"
      );
      editor.closeModal();
    } catch (submitError) {
      draft.setError(
        submitError instanceof Error ? submitError.message : "提交菜单项失败"
      );
    }
  }

  async function confirmDeleteRow() {
    const row = pendingDeleteRow;
    if (!row || !canManage || !token) {
      return;
    }
    draft.clearNotices();
    try {
      setDeletingItemId(row.itemId);
      draft.applyResponse(await deleteAdminMenuItem(token, row.itemId));
      draft.setMessage(`菜单项 ${row.label} 已从草稿中删除。`);
      setPendingDeleteRow(null);
    } catch (deleteError) {
      draft.setError(
        deleteError instanceof Error ? deleteError.message : "删除菜单项失败"
      );
    } finally {
      setDeletingItemId(null);
    }
  }

  async function publishMenuConfig() {
    if (!canManage || !token) {
      return;
    }
    draft.clearNotices();
    try {
      const otpCode = await requestStepUpCode({
        title: "发布菜单配置",
        description:
          "你正在把当前 draft 菜单树切换成全局 published 版本，这会影响所有管理员的导航入口。",
        confirmLabel: "确认发布",
      });
      draft.applyResponse(await publishAdminMenuConfig(token, otpCode));
      draft.setMessage(
        "published 菜单配置已更新。所有管理员将读取新的导航树。"
      );
    } catch (publishError) {
      draft.setError(
        publishError instanceof Error
          ? publishError.message
          : "发布菜单配置失败"
      );
    }
  }

  return {
    pendingDeleteRow,
    deletingItemId,
    setPendingDeleteRow,
    submitItem,
    confirmDeleteRow,
    publishMenuConfig,
  };
}
