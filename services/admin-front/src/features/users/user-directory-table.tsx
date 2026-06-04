"use client";

import { Box, Button, Flex, Grid, Text } from "@chakra-ui/react";

import {
  DataTable,
  SearchInput,
  SentinelStatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
  nativeFieldStyle,
} from "@/components/console-ui";
import { formatDateTime } from "@/lib/admin-console";
import type { AdminRoleCatalogItem, AdminUserItem } from "@/services/admin-api";

import { summarizePermissions } from "./user-presenters";

export function UserDirectoryTable({
  canManage,
  filteredUsers,
  onEdit,
  onRequestDelete,
  roleFilter,
  roles,
  search,
  setRoleFilter,
  setSearch,
  setStatusFilter,
  statusFilter,
  totalUsers,
}: Readonly<{
  canManage: boolean;
  filteredUsers: AdminUserItem[];
  onEdit: (user: AdminUserItem) => void;
  onRequestDelete: (user: AdminUserItem) => void;
  roleFilter: string;
  roles: AdminRoleCatalogItem[];
  search: string;
  setRoleFilter: (value: string) => void;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
  totalUsers: number;
}>) {
  return (
    <SurfaceCard
      eyebrow="Identity Registry"
      title="管理员目录"
      description="以角色模板和 MFA 策略统一编排后台用户，不再让权限散落在独立页面和局部逻辑里。"
      stamp={`${filteredUsers.length}/${totalUsers} users`}
    >
      <UserDirectoryFilters
        roleFilter={roleFilter}
        roles={roles}
        search={search}
        setRoleFilter={setRoleFilter}
        setSearch={setSearch}
        setStatusFilter={setStatusFilter}
        statusFilter={statusFilter}
      />
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
              <Td>
                <SentinelStatusChip
                  label={user.status}
                  tone={user.status === "active" ? "green" : "gray"}
                />
              </Td>
              <Td>
                <Text>{user.requireMfa ? "MFA required" : "MFA optional"}</Text>
                <Text color="ink.500">{user.authSource}</Text>
              </Td>
              <Td>
                <PermissionChips permissions={user.permissions} />
              </Td>
              <Td>{formatDateTime(user.lastLoginAt)}</Td>
              <Td>
                <Flex gap="8px" wrap="wrap">
                  <Button
                    size="sm"
                    borderRadius="full"
                    onClick={() => onEdit(user)}
                    disabled={!canManage}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    borderRadius="full"
                    variant="outline"
                    onClick={() => onRequestDelete(user)}
                    disabled={!canManage || user.status === "disabled"}
                  >
                    禁用
                  </Button>
                </Flex>
              </Td>
            </Box>
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function UserDirectoryFilters({
  roleFilter,
  roles,
  search,
  setRoleFilter,
  setSearch,
  setStatusFilter,
  statusFilter,
}: Readonly<{
  roleFilter: string;
  roles: AdminRoleCatalogItem[];
  search: string;
  setRoleFilter: (value: string) => void;
  setSearch: (value: string) => void;
  setStatusFilter: (value: string) => void;
  statusFilter: string;
}>) {
  return (
    <Grid
      templateColumns={{ base: "1fr", xl: "minmax(0, 320px) 180px 180px" }}
      gap="12px"
      mb="16px"
    >
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="搜索邮箱 / 姓名 / 角色"
      />
      <select
        value={roleFilter}
        onChange={(event) => setRoleFilter(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部角色</option>
        {roles.map((role) => (
          <option key={role.roleKey} value={role.roleKey}>
            {role.roleName}
          </option>
        ))}
      </select>
      <select
        value={statusFilter}
        onChange={(event) => setStatusFilter(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部状态</option>
        <option value="active">active</option>
        <option value="disabled">disabled</option>
      </select>
    </Grid>
  );
}

function PermissionChips({ permissions }: Readonly<{ permissions: string[] }>) {
  const summary = summarizePermissions(permissions);

  return (
    <Flex gap="8px" wrap="wrap">
      {summary.visible.map((permission) => (
        <Box
          key={permission}
          px="10px"
          py="6px"
          borderRadius="full"
          bg="rgba(15,17,21,0.05)"
          color="ink.700"
          fontSize="12px"
        >
          {permission}
        </Box>
      ))}
      {summary.hiddenCount > 0 ? (
        <Box
          px="10px"
          py="6px"
          borderRadius="full"
          bg="rgba(15,17,21,0.05)"
          color="ink.700"
          fontSize="12px"
        >
          +{summary.hiddenCount}
        </Box>
      ) : null}
    </Flex>
  );
}
