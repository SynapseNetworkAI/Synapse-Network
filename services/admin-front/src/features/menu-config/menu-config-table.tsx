"use client";

import { Box, Button, Flex, Grid, Text } from "@chakra-ui/react";

import {
  DataTable,
  SearchInput,
  SurfaceCard,
  TableBody,
  TableHeaderRow,
  Td,
  Th,
  nativeFieldStyle,
} from "@/components/console-ui";
import type { AdminMenuConfigItem } from "@/services/admin-api";

type MenuSectionOption = {
  id: string;
  label: string;
  count: number;
};

export function MenuTopologyTable({
  rows,
  sections,
  search,
  sectionFilter,
  stamp,
  canManage,
  onSearchChange,
  onSectionFilterChange,
  onEdit,
  onDelete,
}: Readonly<{
  rows: AdminMenuConfigItem[];
  sections: MenuSectionOption[];
  search: string;
  sectionFilter: string;
  stamp: string;
  canManage: boolean;
  onSearchChange: (value: string) => void;
  onSectionFilterChange: (value: string) => void;
  onEdit: (row: AdminMenuConfigItem) => void;
  onDelete: (row: AdminMenuConfigItem) => void;
}>) {
  return (
    <SurfaceCard
      eyebrow="Draft Menu Tree"
      title="服务端菜单拓扑"
      description="只编辑草稿版本。发布后，AdminShell 和普通管理员才会读取新的 visible 菜单配置。"
      stamp={stamp}
    >
      <MenuTopologyFilters
        search={search}
        sectionFilter={sectionFilter}
        sections={sections}
        onSearchChange={onSearchChange}
        onSectionFilterChange={onSectionFilterChange}
      />
      <DataTable>
        <TableHeaderRow>
          <Th>菜单项</Th>
          <Th>分组</Th>
          <Th>地址</Th>
          <Th>角色限制</Th>
          <Th>权限限制</Th>
          <Th>操作</Th>
        </TableHeaderRow>
        <TableBody>
          {rows.map((row) => (
            <MenuTopologyRow
              key={row.itemId}
              row={row}
              canManage={canManage}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </TableBody>
      </DataTable>
    </SurfaceCard>
  );
}

function MenuTopologyFilters({
  search,
  sectionFilter,
  sections,
  onSearchChange,
  onSectionFilterChange,
}: Readonly<{
  search: string;
  sectionFilter: string;
  sections: MenuSectionOption[];
  onSearchChange: (value: string) => void;
  onSectionFilterChange: (value: string) => void;
}>) {
  return (
    <Grid
      templateColumns={{ base: "1fr", md: "320px 220px" }}
      gap="12px"
      mb="16px"
    >
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="搜索 label / href / section / keyword"
      />
      <select
        value={sectionFilter}
        onChange={(event) => onSectionFilterChange(event.target.value)}
        style={nativeFieldStyle}
      >
        <option value="all">全部分组</option>
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.label}
          </option>
        ))}
      </select>
    </Grid>
  );
}

function MenuTopologyRow({
  row,
  canManage,
  onEdit,
  onDelete,
}: Readonly<{
  row: AdminMenuConfigItem;
  canManage: boolean;
  onEdit: (row: AdminMenuConfigItem) => void;
  onDelete: (row: AdminMenuConfigItem) => void;
}>) {
  return (
    <Box as="tr">
      <Td>
        <Text fontWeight="700">{row.label}</Text>
        <Text color="ink.500">{row.itemId}</Text>
        <Text color="ink.500">{row.description}</Text>
      </Td>
      <Td>
        <Text fontWeight="700">{row.sectionLabel}</Text>
        <Text color="ink.500">
          {row.nodeType} · parent {row.parentItemId ?? "root"}
        </Text>
        <Text color="ink.500">{row.sectionDescription}</Text>
      </Td>
      <Td>
        <Text>{row.href ?? "-"}</Text>
        <Text color="ink.500">
          icon {row.iconKey} · keywords {row.keywords.join(", ") || "-"}
        </Text>
      </Td>
      <Td>
        {row.requiredRoles.length > 0 ? row.requiredRoles.join(", ") : "公开"}
      </Td>
      <Td>
        {row.requiredPermissions.length > 0
          ? row.requiredPermissions.join(", ")
          : "无额外权限"}
      </Td>
      <Td>
        <Flex gap="8px" wrap="wrap">
          <Button
            size="sm"
            borderRadius="full"
            onClick={() => onEdit(row)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Button
            size="sm"
            borderRadius="full"
            variant="outline"
            onClick={() => onDelete(row)}
            disabled={!canManage}
          >
            删除
          </Button>
        </Flex>
      </Td>
    </Box>
  );
}
