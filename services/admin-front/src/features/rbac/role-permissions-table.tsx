"use client";

import { Box, Button, Flex, Grid, Text } from "@chakra-ui/react";

import {
  DataTable,
  SearchInput,
  StatusChip,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
  nativeFieldStyle,
} from "@/components/console-ui";
import type { AdminRoleCatalogItem } from "@/services/admin-api";

export function RolePermissionsTable({
  roles,
  totalRoles,
  search,
  statusFilter,
  canManage,
  onSearchChange,
  onStatusFilterChange,
  onEdit,
  onDelete,
}: Readonly<{
  roles: AdminRoleCatalogItem[];
  totalRoles: number;
  search: string;
  statusFilter: string;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onEdit: (role: AdminRoleCatalogItem) => void;
  onDelete: (roleKey: string) => void;
}>) {
  return (
    <Box id="permissions-matrix" scrollMarginTop="28px">
      <SurfaceCard
        eyebrow="Permission Matrix"
        title="权限矩阵"
        description="通过角色模板管理权限边界，再由菜单配置和受控动作共同消费。"
        stamp={`${roles.length}/${totalRoles} roles`}
      >
        <RoleTableFilters
          search={search}
          statusFilter={statusFilter}
          onSearchChange={onSearchChange}
          onStatusFilterChange={onStatusFilterChange}
        />
        <DataTable>
          <TableHeaderRow>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>Permissions</Th>
            <Th>Description</Th>
            <Th>Actions</Th>
          </TableHeaderRow>
          <TableBody>
            {roles.map((role) => (
              <RoleTableRow
                key={role.roleKey}
                role={role}
                canManage={canManage}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </TableBody>
        </DataTable>
      </SurfaceCard>
    </Box>
  );
}

function RoleTableFilters({
  search,
  statusFilter,
  onSearchChange,
  onStatusFilterChange,
}: Readonly<{
  search: string;
  statusFilter: string;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
}>) {
  return (
    <Grid
      templateColumns={{ base: "1fr", md: "320px 180px" }}
      gap="12px"
      mb="16px"
    >
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="搜索 role key / role name"
      />
      <select
        value={statusFilter}
        onChange={(event) => onStatusFilterChange(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部状态</option>
        <option value="active">active</option>
        <option value="disabled">disabled</option>
      </select>
    </Grid>
  );
}

function RoleTableRow({
  role,
  canManage,
  onEdit,
  onDelete,
}: Readonly<{
  role: AdminRoleCatalogItem;
  canManage: boolean;
  onEdit: (role: AdminRoleCatalogItem) => void;
  onDelete: (roleKey: string) => void;
}>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="700">{role.roleName}</Text>
        <Text color="ink.500">{role.roleKey}</Text>
      </Td>
      <Td>
        <StatusChip value={role.status} />
      </Td>
      <Td>{role.permissions.length}</Td>
      <Td>{role.description ?? "No description"}</Td>
      <Td>
        <Flex gap="8px" wrap="wrap">
          <Button
            size="sm"
            borderRadius="full"
            onClick={() => onEdit(role)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Button
            size="sm"
            borderRadius="full"
            variant="outline"
            onClick={() => onDelete(role.roleKey)}
            disabled={!canManage || role.status === "disabled"}
          >
            禁用
          </Button>
        </Flex>
      </Td>
    </Box>
  );
}
