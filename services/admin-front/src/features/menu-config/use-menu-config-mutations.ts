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

type MenuMutationContext = {
  token: string | null;
  canManage: boolean;
  draft: ReturnType<typeof useMenuConfigDraft>;
  editor: ReturnType<typeof useMenuItemEditor>;
  requestStepUpCode: StepUpRequester;
};

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
  const context = { token, canManage, draft, editor, requestStepUpCode };

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    await submitMenuItemDraft(context, event);
  }

  async function confirmDeleteRow() {
    await confirmMenuItemDelete(context, {
      row: pendingDeleteRow,
      setDeletingItemId,
      setPendingDeleteRow,
    });
  }

  async function publishMenuConfig() {
    await publishMenuConfigDraft(context);
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

async function submitMenuItemDraft(
  { token, draft, editor }: MenuMutationContext,
  event: FormEvent<HTMLFormElement>
) {
  event.preventDefault();
  if (!token) {
    draft.setError("Missing admin token");
    return;
  }
  await runMenuMutation(
    draft,
    async () => {
      draft.applyResponse(await saveMenuItemDraft(token, editor));
      draft.setMessage(
        editor.editingRow ? "菜单项草稿已更新。" : "菜单项草稿已创建。"
      );
      editor.closeModal();
    },
    "提交菜单项失败"
  );
}

async function confirmMenuItemDelete(
  { token, canManage, draft }: MenuMutationContext,
  {
    row,
    setDeletingItemId,
    setPendingDeleteRow,
  }: Readonly<{
    row: AdminMenuConfigItem | null;
    setDeletingItemId: (itemId: string | null) => void;
    setPendingDeleteRow: (row: AdminMenuConfigItem | null) => void;
  }>
) {
  if (!row || !canManage || !token) {
    return;
  }
  setDeletingItemId(row.itemId);
  await runMenuMutation(
    draft,
    async () => {
      draft.applyResponse(await deleteMenuItemDraft(token, row.itemId));
      draft.setMessage(`菜单项 ${row.label} 已从草稿中删除。`);
      setPendingDeleteRow(null);
    },
    "删除菜单项失败"
  );
  setDeletingItemId(null);
}

async function publishMenuConfigDraft({
  token,
  canManage,
  draft,
  requestStepUpCode,
}: MenuMutationContext) {
  if (!canManage || !token) {
    return;
  }
  await runMenuMutation(
    draft,
    async () => {
      draft.applyResponse(await publishMenuDraft(token, requestStepUpCode));
      draft.setMessage(
        "published 菜单配置已更新。所有管理员将读取新的导航树。"
      );
    },
    "发布菜单配置失败"
  );
}

async function saveMenuItemDraft(
  token: string,
  editor: ReturnType<typeof useMenuItemEditor>
) {
  if (editor.editingRow) {
    return updateAdminMenuItem(
      token,
      editor.editingRow.itemId,
      buildMenuItemDraftPayload(editor.form)
    );
  }
  return createAdminMenuItem(token, buildCreateMenuItemPayload(editor.form));
}

function deleteMenuItemDraft(token: string, itemId: string) {
  return deleteAdminMenuItem(token, itemId);
}

async function publishMenuDraft(
  token: string,
  requestStepUpCode: StepUpRequester
) {
  const otpCode = await requestStepUpCode({
    title: "发布菜单配置",
    description:
      "你正在把当前 draft 菜单树切换成全局 published 版本，这会影响所有管理员的导航入口。",
    confirmLabel: "确认发布",
  });
  return publishAdminMenuConfig(token, otpCode);
}

async function runMenuMutation(
  draft: Pick<
    ReturnType<typeof useMenuConfigDraft>,
    "clearNotices" | "setError"
  >,
  action: () => Promise<void>,
  fallbackError: string
) {
  draft.clearNotices();
  try {
    await action();
  } catch (error) {
    draft.setError(error instanceof Error ? error.message : fallbackError);
  }
}
