"use client";

import {
  FormEvent,
  useDeferredValue,
  useEffect,
  useState,
  useTransition,
} from "react";

import { ConfirmActionModal } from "@/components/confirm-action-modal";
import {
  CrudDrawer,
  CrudEmptyState,
  CrudField,
  CrudSection,
  CrudTable,
  CrudToolbar,
  CrudToolbarFilters,
} from "@/components/crud";
import type { AdminRoleCatalogItem, AdminUserItem } from "@/services/admin-api";

type CreateUserInput = {
  email: string;
  displayName: string;
  roleKey: string;
  password: string;
  requireMfa: boolean;
  status: string;
};

type UpdateUserInput = {
  displayName: string;
  roleKey: string;
  password?: string;
  requireMfa: boolean;
  status: string;
};

type UserManagementProps = {
  users: AdminUserItem[];
  roles: AdminRoleCatalogItem[];
  canCreate: boolean;
  canManage: boolean;
  onCreate: (input: CreateUserInput) => Promise<void>;
  onUpdate: (adminId: string, input: UpdateUserInput) => Promise<void>;
  onDelete: (adminId: string) => Promise<void>;
};

function getUserSubmitLabel(
  isPending: boolean,
  editingUser: AdminUserItem | null
): string {
  if (isPending) {
    return "提交中...";
  }
  if (editingUser) {
    return "保存修改";
  }
  return "创建管理员";
}

function buildFilteredUsers(
  users: AdminUserItem[],
  normalizedSearch: string,
  roleFilter: string
): AdminUserItem[] {
  return users.filter((user) => {
    const matchesSearch =
      !normalizedSearch ||
      user.email.toLowerCase().includes(normalizedSearch) ||
      user.displayName.toLowerCase().includes(normalizedSearch);
    const matchesRole =
      roleFilter === "all" || user.roleKeys.includes(roleFilter);
    return matchesSearch && matchesRole;
  });
}

export function UserManagement({
  users,
  roles,
  canCreate,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
}: Readonly<UserManagementProps>) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleKey, setRoleKey] = useState(roles[0]?.roleKey ?? "");
  const [password, setPassword] = useState("");
  const [requireMfa, setRequireMfa] = useState(false);
  const [status, setStatus] = useState("active");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] =
    useState<AdminUserItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);
  const submitLabel = getUserSubmitLabel(isPending, editingUser);

  useEffect(() => {
    if (!roleKey && roles[0]?.roleKey) {
      setRoleKey(roles[0].roleKey);
    }
  }, [roleKey, roles]);

  const filteredUsers = buildFilteredUsers(
    users,
    deferredSearch.trim().toLowerCase(),
    roleFilter
  );

  function resetForm() {
    setEditingUser(null);
    setEmail("");
    setDisplayName("");
    setRoleKey(roles[0]?.roleKey ?? "");
    setPassword("");
    setRequireMfa(false);
    setStatus("active");
    setMessage(null);
    setError(null);
  }

  function openCreateDrawer() {
    resetForm();
    setDrawerOpen(true);
  }

  function openEditDrawer(user: AdminUserItem) {
    setEditingUser(user);
    setEmail(user.email);
    setDisplayName(user.displayName);
    setRoleKey(user.roleKeys[0] ?? roles[0]?.roleKey ?? "");
    setPassword("");
    setRequireMfa(user.requireMfa);
    setStatus(user.status);
    setMessage(null);
    setError(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    resetForm();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        if (editingUser) {
          await onUpdate(editingUser.adminId, {
            displayName,
            roleKey,
            password: password.trim() ? password : undefined,
            requireMfa,
            status,
          });
          setMessage("后台用户配置已更新。");
        } else {
          await onCreate({
            email,
            displayName,
            roleKey,
            password,
            requireMfa,
            status,
          });
          setMessage("后台用户已创建并绑定角色。");
        }
        globalThis.setTimeout(() => closeDrawer(), 160);
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "创建后台用户失败"
        );
      }
    });
  }

  async function confirmDeleteUser() {
    const user = pendingDeleteUser;
    if (!user || !canManage) {
      return;
    }
    setDeletingId(user.adminId);
    setMessage(null);
    setError(null);
    try {
      await onDelete(user.adminId);
      setMessage(`管理员 ${user.displayName} 已禁用。`);
      setPendingDeleteUser(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "禁用后台用户失败"
      );
    } finally {
      setDeletingId(null);
    }
  }

  function handleDelete(user: AdminUserItem) {
    if (!canManage) {
      return;
    }
    setPendingDeleteUser(user);
  }

  return (
    <div className="module-stack">
      <CrudSection
        eyebrow="Identity Control"
        title="后台用户与角色"
        description="把用户目录、筛选查询和编辑动作收口在一个标准 CRUD 工作台里，后续角色管理和菜单配置都按这套模板复用。"
        stamp={`${filteredUsers.length}/${users.length} admins`}
        toolbar={
          <CrudToolbar>
            <CrudToolbarFilters>
              <CrudField label="搜索">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索邮箱 / 显示名"
                />
              </CrudField>
              <CrudField label="角色筛选" compact>
                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                >
                  <option value="all">全部角色</option>
                  {roles.map((role) => (
                    <option key={role.roleKey} value={role.roleKey}>
                      {role.roleName}
                    </option>
                  ))}
                </select>
              </CrudField>
            </CrudToolbarFilters>
            {canCreate ? (
              <button
                type="button"
                className="button button--primary crud-toolbar__create"
                onClick={openCreateDrawer}
              >
                + 创建后台用户
              </button>
            ) : null}
          </CrudToolbar>
        }
        message={
          message ? (
            <p className="form-message form-message--success">{message}</p>
          ) : null
        }
        error={
          error ? (
            <p className="form-message form-message--error">{error}</p>
          ) : null
        }
      >
        <CrudTable>
          <table className="admin-table">
            <thead>
              <tr>
                <th>管理员</th>
                <th>角色</th>
                <th>状态</th>
                <th>权限</th>
                <th>MFA</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.adminId}>
                  <td>
                    <strong>{user.displayName}</strong>
                    <div className="table-subtext table-subtext--mono">
                      {user.email}
                    </div>
                  </td>
                  <td>
                    <div className="pill-row">
                      {user.roleKeys.map((value) => (
                        <span
                          key={value}
                          className="status-pill status-pill--healthy"
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${
                        user.status === "active"
                          ? "status-pill--healthy"
                          : "status-pill--alert"
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td>
                    <div className="pill-row">
                      {user.permissions.slice(0, 4).map((value) => (
                        <span key={value} className="permission-chip">
                          {value}
                        </span>
                      ))}
                      {user.permissions.length > 4 ? (
                        <span className="permission-chip">
                          +{user.permissions.length - 4}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>{user.requireMfa ? "Required" : "Optional"}</td>
                  <td>
                    <span className="table-subtext table-subtext--mono">
                      {user.lastLoginAt ?? "Never"}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => openEditDrawer(user)}
                        disabled={!canManage}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="ghost-button ghost-button--danger"
                        onClick={() => void handleDelete(user)}
                        disabled={
                          !canManage ||
                          deletingId === user.adminId ||
                          user.status === "disabled"
                        }
                      >
                        {deletingId === user.adminId ? "处理中..." : "删除"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <CrudEmptyState
                      title="未找到匹配的管理员记录"
                      description="调整搜索词或角色筛选，或者直接创建一个新的后台用户。"
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CrudTable>
      </CrudSection>

      <CrudDrawer
        open={isDrawerOpen}
        eyebrow={editingUser ? "Edit Admin" : "Create Admin"}
        title={editingUser ? "编辑后台用户" : "创建后台用户"}
        description="表单被收纳到侧边抽屉，主界面只保留查询和表格，这是中后台正确的工作流密度。"
        onClose={closeDrawer}
      >
        {canManage ? (
          <form
            className="admin-form crud-drawer__form"
            onSubmit={handleSubmit}
          >
            <label>
              <span>邮箱</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="ops-02@synapse-network.ai"
                disabled={Boolean(editingUser)}
              />
            </label>
            <label>
              <span>显示名</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Ops Reviewer"
              />
            </label>
            <label>
              <span>角色模板</span>
              <select
                value={roleKey}
                onChange={(event) => setRoleKey(event.target.value)}
              >
                {roles.map((role) => (
                  <option key={role.roleKey} value={role.roleKey}>
                    {role.roleName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{editingUser ? "重置密码（选填）" : "初始密码"}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  editingUser ? "留空则不改密码" : "Init@StrongPassword"
                }
              />
            </label>
            <label>
              <span>账号状态</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
                <option value="locked">locked</option>
                <option value="pending_invite">pending_invite</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={requireMfa}
                onChange={(event) => setRequireMfa(event.target.checked)}
              />
              <span>要求 MFA</span>
            </label>
            {message ? (
              <p className="form-message form-message--success">{message}</p>
            ) : null}
            {error ? (
              <p className="form-message form-message--error">{error}</p>
            ) : null}
            <div className="crud-drawer__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={closeDrawer}
              >
                取消
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={isPending}
              >
                {submitLabel}
              </button>
            </div>
          </form>
        ) : (
          <p className="panel__text">
            当前角色只有读取能力，不能执行创建或编辑动作。
          </p>
        )}
      </CrudDrawer>
      <ConfirmActionModal
        open={pendingDeleteUser !== null}
        title="禁用管理员"
        description={
          pendingDeleteUser
            ? `确认禁用管理员 ${pendingDeleteUser.displayName} 吗？`
            : ""
        }
        contextLabel={pendingDeleteUser?.email}
        confirmLabel="确认禁用"
        tone="danger"
        loading={
          pendingDeleteUser !== null && deletingId === pendingDeleteUser.adminId
        }
        onCancel={() => setPendingDeleteUser(null)}
        onConfirm={confirmDeleteUser}
      />
    </div>
  );
}
