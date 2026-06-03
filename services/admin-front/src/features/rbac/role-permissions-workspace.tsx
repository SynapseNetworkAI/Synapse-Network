"use client";

import { Button, Grid } from "@chakra-ui/react";
import type { FormEvent } from "react";
import { useDeferredValue, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  createAdminRole,
  deleteAdminRole,
  updateAdminRole,
  type AdminRoleCatalogItem,
} from "@/services/admin-api";

import { RoleEditorModal } from "./role-editor-modal";
import {
  buildCreateRolePayload,
  buildRoleMutationPayload,
  createEmptyRoleForm,
  createRoleFormFromCatalogItem,
  toggleRolePermission,
  type RoleFormState,
} from "./role-form";
import {
  RoleMetricGrid,
  RoleModuleBoundaries,
  RoleRiskSurface,
} from "./role-permissions-summary";
import { RolePermissionsTable } from "./role-permissions-table";
import {
  buildPermissionGroups,
  buildRoleDomainCards,
  buildRoleMetrics,
  buildRoleRiskCards,
  filterRoles,
  sortRolesByPriority,
} from "./role-presenters";
import { useRolePermissionsData } from "./use-role-permissions-data";

export function RolePermissionsWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const data = useRolePermissionsData(token);
  const editor = useRoleEditor();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const viewModel = useRolePermissionsViewModel(
    data.roles,
    data.permissions,
    deferredSearch,
    statusFilter
  );

  if (loading || !admin || data.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="RBAC Matrix Hydration"
        message="正在载入角色权限矩阵..."
      />
    );
  }

  const canManage = admin.role === "super_admin";

  async function handleDelete(roleKey: string) {
    if (!token || !canManage) {
      return;
    }
    data.clearNotices();
    try {
      await deleteAdminRole(token, roleKey);
      await data.loadData(token);
      data.setMessage("角色已禁用。");
    } catch (deleteError) {
      data.setError(
        deleteError instanceof Error ? deleteError.message : "禁用角色失败"
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    data.clearNotices();
    try {
      if (editor.editingRole) {
        await updateAdminRole(
          token,
          editor.editingRole.roleKey,
          buildRoleMutationPayload(editor.form)
        );
        data.setMessage("角色权限已更新。");
      } else {
        await createAdminRole(token, buildCreateRolePayload(editor.form));
        data.setMessage("角色已创建。");
      }
      await data.loadData(token);
      editor.closeModal();
    } catch (submitError) {
      data.setError(
        submitError instanceof Error ? submitError.message : "保存角色失败"
      );
    }
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Role Matrix"
      title="角色权限管理"
      description="把角色模板、权限边界和高风险提权信号收拢成标准治理工作台。"
      actions={
        canManage ? (
          <Button
            borderRadius="full"
            bg="brand.500"
            color="white"
            _hover={{ bg: "brand.600" }}
            onClick={editor.openCreate}
          >
            创建角色
          </Button>
        ) : undefined
      }
    >
      <RoleNotices error={data.error} message={data.message} />
      <RoleMetricGrid
        metrics={viewModel.metrics}
        permissionCount={data.permissions.length}
        canManage={canManage}
      />
      <Grid templateColumns={{ base: "1fr", xl: "0.96fr 1.04fr" }} gap="16px">
        <RoleRiskSurface cards={viewModel.riskCards} />
        <RolePermissionsTable
          roles={viewModel.filteredRoles}
          totalRoles={data.roles.length}
          search={search}
          statusFilter={statusFilter}
          canManage={canManage}
          onSearchChange={setSearch}
          onStatusFilterChange={setStatusFilter}
          onEdit={editor.openEdit}
          onDelete={(roleKey) => void handleDelete(roleKey)}
        />
      </Grid>
      <RoleModuleBoundaries
        permissionGroups={viewModel.permissionGroups}
        domainCards={viewModel.domainCards}
        permissionCount={data.permissions.length}
      />
      <RoleEditorModal
        open={editor.isOpen}
        editingRole={editor.editingRole}
        form={editor.form}
        permissionGroups={viewModel.permissionGroups}
        onClose={editor.closeModal}
        onSubmit={(event) => void handleSubmit(event)}
        onFieldChange={editor.updateField}
        onTogglePermission={editor.togglePermission}
      />
    </AdminShell>
  );
}

function useRolePermissionsViewModel(
  roles: AdminRoleCatalogItem[],
  permissions: Parameters<typeof buildPermissionGroups>[0],
  deferredSearch: string,
  statusFilter: string
) {
  const permissionGroups = useMemo(
    () => buildPermissionGroups(permissions),
    [permissions]
  );
  const metrics = useMemo(
    () => buildRoleMetrics(roles, permissions),
    [roles, permissions]
  );
  const filteredRoles = useMemo(
    () => sortRolesByPriority(filterRoles(roles, deferredSearch, statusFilter)),
    [deferredSearch, roles, statusFilter]
  );
  const domainCards = useMemo(
    () => buildRoleDomainCards(roles, permissions),
    [roles, permissions]
  );
  const riskCards = useMemo(() => buildRoleRiskCards(roles), [roles]);

  return {
    permissionGroups,
    metrics,
    filteredRoles,
    domainCards,
    riskCards,
  };
}

function useRoleEditor() {
  const [editingRole, setEditingRole] = useState<AdminRoleCatalogItem | null>(
    null
  );
  const [isOpen, setOpen] = useState(false);
  const [form, setForm] = useState<RoleFormState>(createEmptyRoleForm());

  function resetForm() {
    setEditingRole(null);
    setForm(createEmptyRoleForm());
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(role: AdminRoleCatalogItem) {
    setEditingRole(role);
    setForm(createRoleFormFromCatalogItem(role));
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  function updateField<Key extends keyof RoleFormState>(
    key: Key,
    value: RoleFormState[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePermission(permissionKey: string) {
    setForm((current) => ({
      ...current,
      permissions: toggleRolePermission(current.permissions, permissionKey),
    }));
  }

  return {
    editingRole,
    isOpen,
    form,
    openCreate,
    openEdit,
    closeModal,
    updateField,
    togglePermission,
  };
}

function RoleNotices({
  error,
  message,
}: Readonly<{ error: string | null; message: string | null }>) {
  return (
    <>
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}
    </>
  );
}
