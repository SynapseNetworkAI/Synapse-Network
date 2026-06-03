"use client";

import type { FormEvent } from "react";

import {
  createAdminRole,
  deleteAdminRole,
  updateAdminRole,
} from "@/services/admin-api";

import {
  buildCreateRolePayload,
  buildRoleMutationPayload,
  type RoleFormState,
} from "./role-form";
import type { useRolePermissionsData } from "./use-role-permissions-data";

type RoleEditorMutationState = {
  editingRole: { roleKey: string } | null;
  form: RoleFormState;
  closeModal: () => void;
};

export function useRolePermissionsMutations({
  token,
  canManage,
  data,
  editor,
}: Readonly<{
  token: string | null;
  canManage: boolean;
  data: ReturnType<typeof useRolePermissionsData>;
  editor: RoleEditorMutationState;
}>) {
  async function deleteRole(roleKey: string) {
    if (!token || !canManage) {
      return;
    }
    await runRoleMutation(
      data,
      async () => {
        await deleteAdminRole(token, roleKey);
        await data.loadData(token);
        data.setMessage("角色已禁用。");
      },
      "禁用角色失败"
    );
  }

  async function submitRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    await runRoleMutation(
      data,
      async () => {
        await saveRoleDraft(token, editor);
        data.setMessage(
          editor.editingRole ? "角色权限已更新。" : "角色已创建。"
        );
        await data.loadData(token);
        editor.closeModal();
      },
      "保存角色失败"
    );
  }

  return {
    deleteRole,
    submitRole,
  };
}

async function saveRoleDraft(token: string, editor: RoleEditorMutationState) {
  if (editor.editingRole) {
    return updateAdminRole(
      token,
      editor.editingRole.roleKey,
      buildRoleMutationPayload(editor.form)
    );
  }
  return createAdminRole(token, buildCreateRolePayload(editor.form));
}

async function runRoleMutation(
  data: Pick<
    ReturnType<typeof useRolePermissionsData>,
    "clearNotices" | "setError" | "setMessage"
  >,
  action: () => Promise<void>,
  fallbackError: string
) {
  data.clearNotices();
  try {
    await action();
  } catch (error) {
    data.setError(error instanceof Error ? error.message : fallbackError);
  }
}
