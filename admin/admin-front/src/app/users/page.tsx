"use client";

import { Box, Button, Flex, Grid, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { DataTable, FieldBlock, MessageBanner, MetricCard, OverlayPanel, SearchInput, SentinelStatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import { useAdminSession } from "@/lib/use-admin-session";
import { buildAdminUserMetrics, buildRoleSnapshots, filterAdminUsers, summarizePermissions } from "@/features/users/user-presenters";
import {
  createAdminUser,
  deleteAdminUser,
  listAdminRoles,
  listAdminUsers,
  updateAdminUser,
  type AdminRoleCatalogItem,
  type AdminUserItem,
} from "@/services/admin-api";

type UserFormState = {
  email: string;
  displayName: string;
  roleKey: string;
  password: string;
  requireMfa: boolean;
  status: string;
};

function createEmptyUserForm(): UserFormState {
  return {
    email: "",
    displayName: "",
    roleKey: "",
    password: "",
    requireMfa: true,
    status: "active",
  };
}

export default function UsersPage() {
  const { admin, token, loading } = useAdminSession();
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [roles, setRoles] = useState<AdminRoleCatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isOpen, setOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [form, setForm] = useState<UserFormState>(createEmptyUserForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const filteredUsers = useMemo(() => {
    return filterAdminUsers(users, deferredSearch, roleFilter, statusFilter);
  }, [deferredSearch, roleFilter, statusFilter, users]);
  const metrics = useMemo(() => buildAdminUserMetrics(users), [users]);
  const roleSnapshots = useMemo(() => buildRoleSnapshots(users, roles), [roles, users]);

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

  const canManage = admin.role === "super_admin";

  function resetForm() {
    setEditingUser(null);
    setForm(createEmptyUserForm());
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function openEdit(user: AdminUserItem) {
    setEditingUser(user);
    setForm({
      email: user.email,
      displayName: user.displayName,
      roleKey: user.roleKeys[0] ?? "",
      password: "",
      requireMfa: user.requireMfa,
      status: user.status,
    });
    setOpen(true);
  }

  async function handleDelete(adminId: string) {
    if (!token || !canManage) {
      return;
    }
    await deleteAdminUser(token, adminId);
    await loadUsersAndRoles(token);
    setMessage("管理员账户已禁用。");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setError(null);
    setMessage(null);
    if (editingUser) {
      await updateAdminUser(token, editingUser.adminId, {
        displayName: form.displayName,
        roleKey: form.roleKey,
        password: form.password.trim() || undefined,
        requireMfa: form.requireMfa,
        status: form.status,
      });
      setMessage("管理员资料已更新。");
    } else {
      await createAdminUser(token, {
        email: form.email,
        displayName: form.displayName,
        roleKey: form.roleKey,
        password: form.password,
        requireMfa: form.requireMfa,
        status: form.status,
      });
      setMessage("管理员账户已创建。");
    }
    await loadUsersAndRoles(token);
    setOpen(false);
    resetForm();
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Admin Users"
      title="后台用户与权限配置"
      description="以角色模板为权限编排单元，菜单树和受控动作都从统一身份模型派生。"
      actions={canManage ? <Button borderRadius="full" bg="brand.500" color="white" _hover={{ bg: "brand.600" }} onClick={openCreate}>新建管理员</Button> : undefined}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Total operators" value={metrics.total} meta="directory entries across all role templates" />
        <MetricCard label="Active operators" value={metrics.active} meta="enabled for active console sessions" />
        <MetricCard label="MFA enforced" value={metrics.requireMfa} meta="Google Authenticator required" />
        <MetricCard label="Privileged roles" value={metrics.privileged} meta="finance / review / super admin surfaces" />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.08fr 0.92fr" }} gap="16px">
        <SurfaceCard eyebrow="Identity Registry" title="管理员目录" description="以角色模板和 MFA 策略统一编排后台用户，不再让权限散落在独立页面和局部逻辑里。" stamp={`${filteredUsers.length}/${users.length} users`}>
        <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px 180px" }} gap="12px" mb="16px">
          <SearchInput value={search} onChange={setSearch} placeholder="搜索邮箱 / 姓名 / 角色" />
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} style={nativeFieldStyle}>
            <option value="all">全部角色</option>
            {roles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.roleName}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={nativeFieldStyle}>
            <option value="all">全部状态</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </Grid>
        <DataTable>
          <TableHeaderRow>
            <Th>Operator</Th>
            <Th>Roles</Th>
            <Th>Status</Th>
            <Th>Security</Th>
            <Th>Permissions</Th>
            <Th>Last Login</Th>
            <Th>Actions</Th>
          </TableHeaderRow>
          <TableBody>
            {filteredUsers.map((user) => (
              <Box as="tr" key={user.adminId}>
                <Td>
                  <Text fontWeight="700">{user.displayName}</Text>
                  <Text color="ink.500">{user.email}</Text>
                </Td>
                <Td>
                  <Text>{user.roleKeys.join(", ") || "-"}</Text>
                  <Text color="ink.500">{user.authSource}</Text>
                </Td>
                <Td><SentinelStatusChip label={user.status} tone={user.status === "active" ? "green" : "gray"} /></Td>
                <Td>
                  <Text>{user.requireMfa ? "MFA required" : "MFA optional"}</Text>
                  <Text color="ink.500">{user.authSource}</Text>
                </Td>
                <Td>
                  <Flex gap="8px" wrap="wrap">
                    {summarizePermissions(user.permissions).visible.map((permission) => (
                      <Box key={permission} px="10px" py="6px" borderRadius="full" bg="rgba(15,17,21,0.05)" color="ink.700" fontSize="12px">{permission}</Box>
                    ))}
                    {summarizePermissions(user.permissions).hiddenCount > 0 ? <Box px="10px" py="6px" borderRadius="full" bg="rgba(15,17,21,0.05)" color="ink.700" fontSize="12px">+{summarizePermissions(user.permissions).hiddenCount}</Box> : null}
                  </Flex>
                </Td>
                <Td>{formatDateTime(user.lastLoginAt)}</Td>
                <Td>
                  <Flex gap="8px" wrap="wrap">
                    <Button size="sm" borderRadius="full" onClick={() => openEdit(user)} disabled={!canManage}>编辑</Button>
                    <Button size="sm" borderRadius="full" variant="outline" onClick={() => void handleDelete(user.adminId)} disabled={!canManage || user.status === "disabled"}>禁用</Button>
                  </Flex>
                </Td>
              </Box>
            ))}
          </TableBody>
        </DataTable>
        </SurfaceCard>

        <Stack gap="16px">
          <SurfaceCard eyebrow="Role Templates" title="角色模板负载" description="让 operator 直接看到每个模板挂了多少人、多少权限，避免角色定义和实际分配脱节。">
            <Stack gap="12px">
              {roleSnapshots.map((role) => (
                <Box key={role.roleKey} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                  <Flex justify="space-between" align="center" gap="12px">
                    <Stack gap="2px">
                      <Heading size="sm">{role.roleName}</Heading>
                      <Text color="ink.500">{role.roleKey}</Text>
                    </Stack>
                    <SentinelStatusChip label={role.status} tone={role.status === "active" ? "green" : "gray"} />
                  </Flex>
                  <Text mt="10px" color="ink.500">{role.assignedUsers} assigned · {role.permissionCount} permissions</Text>
                </Box>
              ))}
            </Stack>
          </SurfaceCard>

          <SurfaceCard eyebrow="Operator Guardrails" title="身份控制基线" description="账号目录只负责身份和角色分配，真正的高风险动作仍由审批、MFA 和执行队列共同约束。">
            <Stack gap="12px">
              <Text color="ink.500">高权限账号必须绑定 MFA，避免浏览器 session 成为唯一防线。</Text>
              <Text color="ink.500">角色模板决定可见 surface，审批与 reviewer 权限决定是否真的能触发资金动作。</Text>
              <Text color="ink.500">禁用账号优先保留审计轨迹，不做硬删除，确保执行历史和登录轨迹可回放。</Text>
            </Stack>
          </SurfaceCard>
        </Stack>
      </Grid>

      <OverlayPanel open={isOpen} title={editingUser ? "编辑管理员" : "创建管理员"} description="变更会直接写入 gateway-admin 用户目录，并影响会话、角色和菜单可见性。" onClose={() => { setOpen(false); resetForm(); }}>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <Stack gap="16px">
            <FieldBlock label="Email">
              <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} disabled={editingUser !== null} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <FieldBlock label="Display Name">
              <Input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <FieldBlock label="Role Template">
              <select value={form.roleKey} onChange={(event) => setForm((current) => ({ ...current, roleKey: event.target.value }))} style={nativeFieldStyle}>
                <option value="">选择角色</option>
                {roles.map((role) => <option key={role.roleKey} value={role.roleKey}>{role.roleName}</option>)}
              </select>
            </FieldBlock>
            <FieldBlock label="Password" hint={editingUser ? "留空表示不变更密码。" : "创建用户时必须提供初始密码。"}>
              <Input value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} type="password" borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
              <FieldBlock label="Status">
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} style={nativeFieldStyle}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </FieldBlock>
              <FieldBlock label="MFA">
                <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input type="checkbox" checked={form.requireMfa} onChange={(event) => setForm((current) => ({ ...current, requireMfa: event.target.checked }))} />
                  <span>Require Google Authenticator</span>
                </label>
              </FieldBlock>
            </Grid>
            <Button type="submit" bg="brand.500" color="white" borderRadius="18px" h="52px" _hover={{ bg: "brand.600" }}>
              {editingUser ? "保存修改" : "创建管理员"}
            </Button>
          </Stack>
        </form>
      </OverlayPanel>
    </AdminShell>
  );
}