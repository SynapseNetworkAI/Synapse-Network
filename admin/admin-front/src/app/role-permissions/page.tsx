"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";

import { AdminShell } from "@/components/admin-shell";
import { CrudDrawer, CrudField, CrudSection, CrudTable, CrudToolbar, CrudToolbarFilters } from "@/components/crud";
import { useAdminSession } from "@/lib/use-admin-session";
import {
  createAdminRole,
  deleteAdminRole,
  listAdminPermissions,
  listAdminRoles,
  updateAdminRole,
  type AdminPermissionCatalogItem,
  type AdminRoleCatalogItem,
} from "@/services/admin-api";

type RoleFormState = {
  roleKey: string;
  roleName: string;
  description: string;
  status: string;
  permissions: string[];
};

function buildPermissionGroups(permissions: AdminPermissionCatalogItem[]) {
  const groups = new Map<string, AdminPermissionCatalogItem[]>();
  permissions.forEach((permission) => {
    const current = groups.get(permission.resourceDomain) ?? [];
    current.push(permission);
    groups.set(permission.resourceDomain, current);
  });
  return Array.from(groups.entries())
    .map(([domain, items]) => {
      const sortedItems = [...items].sort((left, right) => left.permissionKey.localeCompare(right.permissionKey));
      return {
        domain,
        items: sortedItems,
      };
    })
    .sort((left, right) => left.domain.localeCompare(right.domain));
}

function getRoleSubmitLabel(isPending: boolean, editingRole: AdminRoleCatalogItem | null): string {
  if (isPending) {
    return "提交中...";
  }
  if (editingRole) {
    return "保存角色";
  }
  return "创建角色";
}

function createEmptyRoleForm(): RoleFormState {
  return {
    roleKey: "",
    roleName: "",
    description: "",
    status: "active",
    permissions: [],
  };
}

export default function RolePermissionsPage() {
  const { admin, token, loading } = useAdminSession();
  const [roles, setRoles] = useState<AdminRoleCatalogItem[]>([]);
  const [permissions, setPermissions] = useState<AdminPermissionCatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<AdminRoleCatalogItem | null>(null);
  const [form, setForm] = useState<RoleFormState>(createEmptyRoleForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

  async function loadData(activeToken: string) {
    const [roleResponse, permissionResponse] = await Promise.all([
      listAdminRoles(activeToken),
      listAdminPermissions(activeToken),
    ]);
    setRoles(roleResponse.items);
    setPermissions(permissionResponse.items);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const activeToken = token;
    let cancelled = false;
    async function load() {
      try {
        await loadData(activeToken);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载角色权限矩阵失败");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const permissionGroups = useMemo(() => buildPermissionGroups(permissions), [permissions]);
  const filteredRoles = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLowerCase();
    return roles.filter((role) => {
      const matchesSearch = !normalizedSearch
        || role.roleKey.toLowerCase().includes(normalizedSearch)
        || role.roleName.toLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === "all" || role.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [deferredSearch, roles, statusFilter]);

  if (loading || !admin) {
    return <main className="state-screen">正在载入角色权限矩阵...</main>;
  }

  const canManage = admin.role === "super_admin";
  const submitLabel = getRoleSubmitLabel(isPending, editingRole);

  function resetForm() {
    setEditingRole(null);
    setForm(createEmptyRoleForm());
    setMessage(null);
    setError(null);
  }

  function openCreateDrawer() {
    resetForm();
    setDrawerOpen(true);
  }

  function openEditDrawer(role: AdminRoleCatalogItem) {
    setEditingRole(role);
    setForm({
      roleKey: role.roleKey,
      roleName: role.roleName,
      description: role.description ?? "",
      status: role.status,
      permissions: role.permissions,
    });
    setMessage(null);
    setError(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    resetForm();
  }

  function togglePermission(permissionKey: string) {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permissionKey)
        ? current.permissions.filter((item) => item !== permissionKey)
        : [...current.permissions, permissionKey].sort((left, right) => left.localeCompare(right)),
    }));
  }

  function updateField<Key extends keyof RoleFormState>(key: Key, value: RoleFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        if (!token) {
          throw new Error("Missing admin token");
        }
        if (editingRole) {
          await updateAdminRole(token, editingRole.roleKey, {
            roleName: form.roleName,
            description: form.description,
            status: form.status,
            permissions: form.permissions,
          });
          setMessage("角色权限已更新。");
        } else {
          await createAdminRole(token, {
            roleKey: form.roleKey,
            roleName: form.roleName,
            description: form.description,
            status: form.status,
            permissions: form.permissions,
          });
          setMessage("角色已创建。");
        }
        await loadData(token);
        globalThis.setTimeout(() => closeDrawer(), 140);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "提交角色失败");
      }
    });
  }

  async function handleDelete(role: AdminRoleCatalogItem) {
    if (!canManage || !token) {
      return;
    }
    const confirmed = globalThis.confirm(`确认禁用角色 ${role.roleName} 吗？`);
    if (!confirmed) {
      return;
    }
    setDeletingKey(role.roleKey);
    setMessage(null);
    setError(null);
    try {
      await deleteAdminRole(token, role.roleKey);
      await loadData(token);
      setMessage(`角色 ${role.roleName} 已禁用。`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "禁用角色失败");
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Role Matrix"
      title="角色权限管理"
      description="把角色定义、权限映射和状态管理收拢成标准 CRUD 页面，后续所有配置型后台页都按这个骨架走。"
    >
      <CrudSection
        eyebrow="Role Catalog"
        title="角色目录与权限边界"
        description="列表负责检索与操作，表单收进右侧抽屉。兄弟，这才是中后台该有的体面，不是把权限芯片平铺成一堵墙。"
        stamp={`${filteredRoles.length}/${roles.length} roles`}
        toolbar={(
          <CrudToolbar>
            <CrudToolbarFilters>
              <CrudField label="搜索角色">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 role key / role name" />
              </CrudField>
              <CrudField label="状态筛选" compact>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">全部状态</option>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </CrudField>
            </CrudToolbarFilters>
            {canManage ? <button type="button" className="button button--primary crud-toolbar__create" onClick={openCreateDrawer}>+ 创建角色</button> : null}
          </CrudToolbar>
        )}
        message={message ? <p className="form-message form-message--success">{message}</p> : null}
        error={error ? <p className="form-message form-message--error">{error}</p> : null}
      >
        <CrudTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>状态</th>
                <th>权限数</th>
                <th>说明</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoles.map((role) => (
                <tr key={role.roleKey}>
                  <td>
                    <strong>{role.roleName}</strong>
                    <div className="table-subtext table-subtext--mono">{role.roleKey}</div>
                  </td>
                  <td><span className={`status-pill ${role.status === "active" ? "status-pill--healthy" : "status-pill--alert"}`}>{role.status}</span></td>
                  <td><span className="table-subtext table-subtext--mono">{role.permissions.length}</span></td>
                  <td><span className="table-subtext">{role.description ?? "No description"}</span></td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="ghost-button" onClick={() => openEditDrawer(role)} disabled={!canManage}>编辑</button>
                      <button
                        type="button"
                        className="ghost-button ghost-button--danger"
                        onClick={() => void handleDelete(role)}
                        disabled={!canManage || deletingKey === role.roleKey || role.status === "disabled"}
                      >
                        {deletingKey === role.roleKey ? "处理中..." : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CrudTable>
      </CrudSection>

      <section className="panel">
        <div className="panel__header">
          <div>
            <p className="panel__eyebrow">Permission Domains</p>
            <h3 className="panel__title">权限域索引</h3>
          </div>
          <span className="dashboard-section__stamp">{permissions.length} permissions</span>
        </div>
        <div className="catalog-list catalog-list--three">
          {permissionGroups.map((group) => (
            <div key={group.domain} className="catalog-card">
              <div className="catalog-card__header">
                <strong>{group.domain}</strong>
                <span className="sidebar__badge">{group.items.length}</span>
              </div>
              <div className="pill-row">
                {group.items.map((item) => (
                  <span key={item.permissionKey} className="permission-chip">{item.permissionKey}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <CrudDrawer
        open={isDrawerOpen}
        eyebrow={editingRole ? "Edit Role" : "Create Role"}
        title={editingRole ? "编辑角色" : "创建角色"}
        description="角色信息与权限勾选都放进抽屉，不再污染主列表视野。"
        onClose={closeDrawer}
      >
        <form className="admin-form crud-drawer__form" onSubmit={handleSubmit}>
          <label>
            <span>Role Key</span>
            <input value={form.roleKey} onChange={(event) => updateField("roleKey", event.target.value)} disabled={Boolean(editingRole)} placeholder="ops_shift_manager" />
          </label>
          <label>
            <span>Role Name</span>
            <input value={form.roleName} onChange={(event) => updateField("roleName", event.target.value)} placeholder="Ops Shift Manager" />
          </label>
          <label>
            <span>Description</span>
            <input value={form.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Role description" />
          </label>
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <div className="permission-selector">
            <span className="crud-field__label">权限选择</span>
            <div className="permission-selector__grid">
              {permissionGroups.map((group) => (
                <section key={group.domain} className="permission-selector__group">
                  <strong>{group.domain}</strong>
                  {group.items.map((item) => (
                    <label key={item.permissionKey} className="permission-selector__item">
                      <input
                        type="checkbox"
                        aria-label={item.permissionKey}
                        checked={form.permissions.includes(item.permissionKey)}
                        onChange={() => togglePermission(item.permissionKey)}
                      />
                      <span>
                        <span className="table-subtext table-subtext--mono">{item.permissionKey}</span>
                        <small className="table-subtext">{item.riskLevel}</small>
                      </span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
          </div>
          <div className="crud-drawer__actions">
            <button type="button" className="button button--secondary" onClick={closeDrawer}>取消</button>
            <button type="submit" className="button button--primary" disabled={isPending}>{submitLabel}</button>
          </div>
        </form>
      </CrudDrawer>
    </AdminShell>
  );
}
