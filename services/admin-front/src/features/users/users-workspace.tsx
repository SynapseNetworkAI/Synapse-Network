"use client";

import { Button, Grid, Stack } from "@chakra-ui/react";

import { AdminShell } from "@/components/admin-shell";
import { ControlPlaneLoadingScreen } from "@/components/control-plane-loading-screen";
import { MessageBanner } from "@/components/console-ui";
import { useAdminSession } from "@/lib/use-admin-session";
import type { AdminProfile } from "@/services/admin-api";

import { RoleTemplatePanel } from "./role-template-panel";
import { canManageAdminUsers } from "./user-presenters";
import { UserDeleteConfirmModal } from "./user-delete-confirm-modal";
import { UserDirectoryTable } from "./user-directory-table";
import { UserEditorOverlay } from "./user-editor-modal";
import { UserSummary } from "./user-summary";
import { useAdminUsers } from "./use-admin-users";

export function UsersWorkspace() {
  const { admin, token, loading } = useAdminSession();
  const adminUsers = useAdminUsers(token);

  if (loading || !admin || adminUsers.bootstrapping) {
    return (
      <ControlPlaneLoadingScreen
        title="Operator Directory Hydration"
        message="正在读取后台用户目录..."
      />
    );
  }

  return <UsersShell admin={admin} adminUsers={adminUsers} />;
}

function UsersShell({
  admin,
  adminUsers,
}: Readonly<{
  admin: AdminProfile;
  adminUsers: ReturnType<typeof useAdminUsers>;
}>) {
  const canManage = canManageAdminUsers(admin);

  return (
    <AdminShell
      admin={admin}
      eyebrow="Admin Users"
      title="后台用户与权限配置"
      description="以角色模板为权限编排单元，菜单树和受控动作都从统一身份模型派生。"
      actions={
        canManage ? (
          <Button
            borderRadius="full"
            bg="brand.500"
            color="white"
            _hover={{ bg: "brand.600" }}
            onClick={adminUsers.openCreateUser}
          >
            新建管理员
          </Button>
        ) : undefined
      }
    >
      <Stack gap="16px">
        {adminUsers.error ? (
          <MessageBanner kind="error" message={adminUsers.error} />
        ) : null}
        {adminUsers.notice ? (
          <MessageBanner kind="success" message={adminUsers.notice} />
        ) : null}
        <UserSummary metrics={adminUsers.metrics} />
        <Grid templateColumns={{ base: "1fr", xl: "1.08fr 0.92fr" }} gap="16px">
          <UserDirectoryTable
            canManage={canManage}
            filteredUsers={adminUsers.filteredUsers}
            onEdit={adminUsers.openEditUser}
            onRequestDelete={adminUsers.requestDeleteUser}
            roleFilter={adminUsers.roleFilter}
            roles={adminUsers.roles}
            search={adminUsers.search}
            setRoleFilter={adminUsers.setRoleFilter}
            setSearch={adminUsers.setSearch}
            setStatusFilter={adminUsers.setStatusFilter}
            statusFilter={adminUsers.statusFilter}
            totalUsers={adminUsers.users.length}
          />
          <RoleTemplatePanel roleSnapshots={adminUsers.roleSnapshots} />
        </Grid>
      </Stack>
      <UserEditorOverlay
        editingUser={adminUsers.editingUser}
        form={adminUsers.form}
        isOpen={adminUsers.isEditorOpen}
        onClose={adminUsers.closeEditor}
        roles={adminUsers.roles}
        setForm={adminUsers.setForm}
        submitting={adminUsers.submitting}
        submitUserForm={adminUsers.submitUserForm}
      />
      <UserDeleteConfirmModal
        deletingAdminId={adminUsers.deletingAdminId}
        onCancel={adminUsers.cancelDeleteUser}
        onConfirm={adminUsers.confirmDeleteUser}
        user={adminUsers.pendingDeleteUser}
      />
    </AdminShell>
  );
}
