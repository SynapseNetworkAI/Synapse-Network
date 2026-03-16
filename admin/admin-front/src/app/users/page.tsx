"use client";

import { useEffect, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { UserManagement } from "@/features/users/user-management";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  createAdminUser,
  deleteAdminUser,
  listAdminRoles,
  listAdminUsers,
  updateAdminUser,
  type AdminRoleCatalogItem,
  type AdminUserItem,
} from "@/services/admin-api";


export default function UsersPage() {
  const { admin, token, loading } = useAdminSession();
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [roles, setRoles] = useState<AdminRoleCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadUsersAndRoles(activeToken: string) {
    const [userResponse, roleResponse] = await Promise.all([
      listAdminUsers(activeToken),
      listAdminRoles(activeToken),
    ]);
    setUsers(userResponse.items);
    setRoles(roleResponse.items);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        await loadUsersAndRoles(activeToken);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载后台用户失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || !admin) {
    return <main className="state-screen">正在读取后台用户目录...</main>;
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Admin Users"
      title="后台用户与权限配置"
      description="以角色模板为权限编排单元，菜单树和受控动作都从统一身份模型派生。"
    >
      {error ? <section className="panel"><p className="form-message form-message--error">{error}</p></section> : null}
      <UserManagement
        users={users}
        roles={roles}
        canCreate={admin.role === "super_admin"}
        canManage={admin.role === "super_admin"}
        onCreate={async (input) => {
          if (!token) {
            throw new Error("Missing admin token");
          }
          const activeToken = token;
          await createAdminUser(activeToken, input);
          await loadUsersAndRoles(activeToken);
        }}
        onUpdate={async (adminId, input) => {
          if (!token) {
            throw new Error("Missing admin token");
          }
          const activeToken = token;
          await updateAdminUser(activeToken, adminId, input);
          await loadUsersAndRoles(activeToken);
        }}
        onDelete={async (adminId) => {
          if (!token) {
            throw new Error("Missing admin token");
          }
          const activeToken = token;
          await deleteAdminUser(activeToken, adminId);
          await loadUsersAndRoles(activeToken);
        }}
      />
    </AdminShell>
  );
}