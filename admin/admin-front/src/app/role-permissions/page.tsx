"use client";

import { Box, Button, Flex, Grid, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin-shell";
import { DataTable, FieldBlock, MessageBanner, MetricCard, OverlayPanel, SearchInput, SentinelStatusChip, StatusChip, SurfaceCard, TableBody, TableHeaderRow, Td, Th, nativeFieldStyle } from "@/components/console-ui";
import { buildPermissionGroups, buildRoleDomainCards, buildRoleMetrics, buildRoleRiskCards, filterRoles, sortRolesByPriority } from "@/features/rbac/role-presenters";
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
  const [editingRole, setEditingRole] = useState<AdminRoleCatalogItem | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [form, setForm] = useState<RoleFormState>(createEmptyRoleForm());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
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
        if (!cancelled) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载角色权限矩阵失败");
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const permissionGroups = useMemo(() => buildPermissionGroups(permissions), [permissions]);
  const metrics = useMemo(() => buildRoleMetrics(roles, permissions), [roles, permissions]);
  const filteredRoles = useMemo(() => sortRolesByPriority(filterRoles(roles, deferredSearch, statusFilter)), [deferredSearch, roles, statusFilter]);
  const domainCards = useMemo(() => buildRoleDomainCards(roles, permissions), [roles, permissions]);
  const riskCards = useMemo(() => buildRoleRiskCards(roles), [roles]);

  if (loading || !admin || bootstrapping) {
    return <main className="state-screen">正在载入角色权限矩阵...</main>;
  }

  const canManage = admin.role === "super_admin";

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
    setForm({
      roleKey: role.roleKey,
      roleName: role.roleName,
      description: role.description ?? "",
      status: role.status,
      permissions: role.permissions,
    });
    setOpen(true);
  }

  function togglePermission(permissionKey: string) {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permissionKey)
        ? current.permissions.filter((item) => item !== permissionKey)
        : [...current.permissions, permissionKey].sort((left, right) => left.localeCompare(right)),
    }));
  }

  async function handleDelete(roleKey: string) {
    if (!token || !canManage) {
      return;
    }
    await deleteAdminRole(token, roleKey);
    await loadData(token);
    setMessage("角色已禁用。");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
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
    setOpen(false);
    resetForm();
  }

  return (
    <AdminShell
      admin={admin}
      eyebrow="Role Matrix"
      title="角色权限管理"
      description="把角色模板、权限边界和高风险提权信号收拢成标准治理工作台。"
      actions={canManage ? <Button borderRadius="full" bg="brand.500" color="white" _hover={{ bg: "brand.600" }} onClick={openCreate}>创建角色</Button> : undefined}
    >
      {error ? <MessageBanner kind="error" message={error} /> : null}
      {message ? <MessageBanner kind="success" message={message} /> : null}

      <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }} gap="16px">
        <MetricCard label="Role catalog" value={metrics.totalRoles} meta={`${metrics.activeCount} active / ${metrics.disabledCount} disabled`} />
        <MetricCard label="Permission coverage" value={`${metrics.coveredPermissionCount}/${permissions.length}`} meta={`${metrics.uncoveredPermissionCount} still uncovered`} />
        <MetricCard label="Max privilege span" value={metrics.maxPermissionCount} meta="widest single-role permission surface" accent="linear-gradient(180deg, rgba(255,251,244,0.98) 0%, rgba(255,242,226,0.96) 100%)" />
        <MetricCard label="Governance mode" value={canManage ? "WRITE" : "READ"} meta={canManage ? "super_admin can grant/revoke" : "session is read-only"} />
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "0.96fr 1.04fr" }} gap="16px">
        <SurfaceCard eyebrow="Elevation Risk" title="高风险角色面" description="角色治理的核心不是建表，而是快速识别谁拥有过宽权限面，谁具备提权能力。">
          <Stack gap="12px">
            {riskCards.map((card) => (
              <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                <Stack direction="row" justify="space-between" align="center">
                  <Stack gap="4px">
                    <Heading size="sm">{card.label}</Heading>
                    <Text color="ink.500">{card.roleKey}</Text>
                  </Stack>
                  <SentinelStatusChip label={`${card.permissionCount} perms`} tone={card.tone} />
                </Stack>
                <Text mt="8px" color="ink.500">{card.description}</Text>
              </Box>
            ))}
            <Box borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Text fontSize="11px" letterSpacing="0.18em" textTransform="uppercase" color="ink.500">RBAC Guardrail</Text>
              <Text mt="8px" color="ink.500">前端不能只做菜单隐藏。角色页要明确区分可读、可发起、可审批和可执行的边界，尤其是 `admin_role:grant` 这类高风险能力。</Text>
            </Box>
          </Stack>
        </SurfaceCard>

        <SurfaceCard eyebrow="Role Catalog" title="角色目录与权限边界" description="通过角色模板管理权限边界，再由菜单配置和受控动作共同消费。" stamp={`${filteredRoles.length}/${roles.length} roles`}>
        <Grid templateColumns={{ base: "1fr", md: "320px 180px" }} gap="12px" mb="16px">
          <SearchInput value={search} onChange={setSearch} placeholder="搜索 role key / role name" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={nativeFieldStyle}>
            <option value="all">全部状态</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        </Grid>
        <DataTable>
          <TableHeaderRow>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>Permissions</Th>
            <Th>Description</Th>
            <Th>Actions</Th>
          </TableHeaderRow>
          <TableBody>
            {filteredRoles.map((role) => (
              <Box as="tr" key={role.roleKey}>
                <Td>
                  <Text fontWeight="700">{role.roleName}</Text>
                  <Text color="ink.500">{role.roleKey}</Text>
                </Td>
                <Td><StatusChip value={role.status} /></Td>
                <Td>{role.permissions.length}</Td>
                <Td>{role.description ?? "No description"}</Td>
                <Td>
                  <Flex gap="8px" wrap="wrap">
                    <Button size="sm" borderRadius="full" onClick={() => openEdit(role)} disabled={!canManage}>编辑</Button>
                    <Button size="sm" borderRadius="full" variant="outline" onClick={() => void handleDelete(role.roleKey)} disabled={!canManage || role.status === "disabled"}>禁用</Button>
                  </Flex>
                </Td>
              </Box>
            ))}
          </TableBody>
        </DataTable>
      </SurfaceCard>
      </Grid>

      <Grid templateColumns={{ base: "1fr", xl: "1.04fr 0.96fr" }} gap="16px">
      <SurfaceCard eyebrow="Permission Domains" title="权限域索引" description="按 resource domain 展示完整 permission catalog，便于角色建模时快速核对。" stamp={`${permissions.length} permissions`}>
        <Grid templateColumns={{ base: "1fr", lg: "repeat(3, 1fr)" }} gap="12px">
          {permissionGroups.map((group) => (
            <Box key={group.domain} borderRadius="20px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Heading size="sm">{group.domain}</Heading>
              <Stack gap="8px" mt="10px">
                {group.items.map((permission) => (
                  <Box key={permission.permissionKey} borderRadius="14px" p="10px" bg="rgba(247,241,233,0.80)">
                    <Text fontWeight="700">{permission.permissionKey}</Text>
                    <Text color="ink.500">{permission.action} · {permission.riskLevel}</Text>
                  </Box>
                ))}
              </Stack>
            </Box>
          ))}
        </Grid>
      </SurfaceCard>
      <SurfaceCard eyebrow="Domain Coverage" title="资源域覆盖率" description="先看哪些权限域已经被活动角色覆盖，哪些仍然裸露，才能判断当前 RBAC 是否成体系。">
        <Stack gap="12px">
          {domainCards.map((card) => (
            <Box key={card.key} borderRadius="22px" p="16px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
              <Stack direction="row" justify="space-between" align="center">
                <Heading size="sm">{card.label}</Heading>
                <SentinelStatusChip label={`${card.coveredCount}/${card.permissionCount}`} tone={card.coveredCount === card.permissionCount ? "green" : "orange"} />
              </Stack>
              <Text mt="8px" color="ink.500">active roles {card.activeRoleCount}</Text>
            </Box>
          ))}
        </Stack>
      </SurfaceCard>
      </Grid>
      <OverlayPanel open={isOpen} title={editingRole ? "编辑角色" : "创建角色"} description="角色会影响可见菜单、审批能力和高风险动作边界。" onClose={() => { setOpen(false); resetForm(); }}>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <Stack gap="16px">
            <FieldBlock label="Role Key">
              <Input value={form.roleKey} onChange={(event) => setForm((current) => ({ ...current, roleKey: event.target.value }))} disabled={editingRole !== null} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <FieldBlock label="Role Name">
              <Input value={form.roleName} onChange={(event) => setForm((current) => ({ ...current, roleName: event.target.value }))} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <FieldBlock label="Description">
              <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} borderRadius="16px" h="50px" bg="rgba(255,255,255,0.88)" borderColor="rgba(99,92,82,0.16)" />
            </FieldBlock>
            <FieldBlock label="Status">
              <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} style={nativeFieldStyle}>
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>
            </FieldBlock>
            <FieldBlock label="Permissions">
              <Stack gap="12px" maxH="360px" overflowY="auto" pr="6px">
                {permissionGroups.map((group) => (
                  <Box key={group.domain} borderRadius="18px" p="14px" bg="rgba(255,255,255,0.74)" border="1px solid rgba(99,92,82,0.10)">
                    <Text fontWeight="700" mb="10px">{group.domain}</Text>
                    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="8px">
                      {group.items.map((permission) => (
                        <Box as="label" key={permission.permissionKey} display="flex" gap="8px" alignItems="flex-start">
                          <input type="checkbox" checked={form.permissions.includes(permission.permissionKey)} onChange={() => togglePermission(permission.permissionKey)} />
                          <span>
                            <strong>{permission.permissionKey}</strong>
                            <span style={{ display: "block", color: "#635c52" }}>{permission.description ?? `${permission.action} · ${permission.riskLevel}`}</span>
                          </span>
                        </Box>
                      ))}
                    </Grid>
                  </Box>
                ))}
              </Stack>
            </FieldBlock>
            <Button type="submit" bg="brand.500" color="white" borderRadius="18px" h="52px" _hover={{ bg: "brand.600" }}>
              {editingRole ? "保存角色" : "创建角色"}
            </Button>
          </Stack>
        </form>
      </OverlayPanel>
    </AdminShell>
  );
}
