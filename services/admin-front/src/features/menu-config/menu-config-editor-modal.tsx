"use client";

import { Button, Grid, Input, Stack } from "@chakra-ui/react";
import type { FormEvent } from "react";

import {
  FieldBlock,
  OverlayPanel,
  nativeFieldStyle,
} from "@/components/console-ui";
import type { AdminMenuConfigItem } from "@/services/admin-api";

import type { MenuFormState } from "./menu-config-form";

export function MenuConfigEditorModal({
  open,
  editingRow,
  form,
  topologyRows,
  onClose,
  onSubmit,
  onFieldChange,
}: Readonly<{
  open: boolean;
  editingRow: AdminMenuConfigItem | null;
  form: MenuFormState;
  topologyRows: AdminMenuConfigItem[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFieldChange: <Key extends keyof MenuFormState>(
    key: Key,
    value: MenuFormState[Key]
  ) => void;
}>) {
  return (
    <OverlayPanel
      open={open}
      title={editingRow ? "编辑菜单项" : "创建菜单项"}
      description="draft 菜单树由 backend 托管；发布后会影响所有管理员的可见导航。"
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <Stack gap="16px">
          <MenuIdentityFields
            form={form}
            editingRow={editingRow}
            onFieldChange={onFieldChange}
          />
          <MenuTopologyFields
            form={form}
            topologyRows={topologyRows}
            onFieldChange={onFieldChange}
          />
          <MenuDisplayFields form={form} onFieldChange={onFieldChange} />
          <MenuAccessFields form={form} onFieldChange={onFieldChange} />
          <FieldBlock label="Sort Order">
            <MenuTextInput
              value={form.sortOrder}
              type="number"
              onChange={(value) => onFieldChange("sortOrder", value)}
            />
          </FieldBlock>
          <Button
            type="submit"
            bg="brand.500"
            color="white"
            borderRadius="18px"
            h="52px"
            _hover={{ bg: "brand.600" }}
          >
            {editingRow ? "保存菜单项" : "创建菜单项"}
          </Button>
        </Stack>
      </form>
    </OverlayPanel>
  );
}

function MenuIdentityFields({
  form,
  editingRow,
  onFieldChange,
}: Readonly<{
  form: MenuFormState;
  editingRow: AdminMenuConfigItem | null;
  onFieldChange: <Key extends keyof MenuFormState>(
    key: Key,
    value: MenuFormState[Key]
  ) => void;
}>) {
  return (
    <>
      <FieldBlock label="Item Id">
        <MenuTextInput
          value={form.itemId}
          disabled={editingRow !== null}
          onChange={(value) => onFieldChange("itemId", value)}
        />
      </FieldBlock>
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
        <FieldBlock label="Section Id">
          <MenuTextInput
            value={form.sectionId}
            onChange={(value) => onFieldChange("sectionId", value)}
          />
        </FieldBlock>
        <FieldBlock label="Section Label">
          <MenuTextInput
            value={form.sectionLabel}
            onChange={(value) => onFieldChange("sectionLabel", value)}
          />
        </FieldBlock>
      </Grid>
      <FieldBlock label="Section Description">
        <MenuTextInput
          value={form.sectionDescription}
          onChange={(value) => onFieldChange("sectionDescription", value)}
        />
      </FieldBlock>
    </>
  );
}

function MenuTopologyFields({
  form,
  topologyRows,
  onFieldChange,
}: Readonly<{
  form: MenuFormState;
  topologyRows: AdminMenuConfigItem[];
  onFieldChange: <Key extends keyof MenuFormState>(
    key: Key,
    value: MenuFormState[Key]
  ) => void;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
      <FieldBlock label="Node Type">
        <select
          value={form.nodeType}
          onChange={(event) =>
            onFieldChange(
              "nodeType",
              event.target.value as MenuFormState["nodeType"]
            )
          }
          style={nativeFieldStyle}
        >
          <option value="category">category</option>
          <option value="page">page</option>
          <option value="panel">panel</option>
        </select>
      </FieldBlock>
      <FieldBlock label="Parent Item">
        <select
          value={form.parentItemId}
          onChange={(event) =>
            onFieldChange("parentItemId", event.target.value)
          }
          style={nativeFieldStyle}
        >
          <option value="">root</option>
          {topologyRows
            .filter((row) => row.itemId !== form.itemId)
            .map((row) => (
              <option key={row.itemId} value={row.itemId}>
                {row.label} ({row.itemId})
              </option>
            ))}
        </select>
      </FieldBlock>
    </Grid>
  );
}

function MenuDisplayFields({
  form,
  onFieldChange,
}: Readonly<{
  form: MenuFormState;
  onFieldChange: <Key extends keyof MenuFormState>(
    key: Key,
    value: MenuFormState[Key]
  ) => void;
}>) {
  return (
    <>
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
        <FieldBlock label="Label">
          <MenuTextInput
            value={form.label}
            onChange={(value) => onFieldChange("label", value)}
          />
        </FieldBlock>
        <FieldBlock label="Href">
          <MenuTextInput
            value={form.href}
            placeholder={
              form.nodeType === "page"
                ? "/menu-path"
                : "category / panel 节点留空"
            }
            onChange={(value) => onFieldChange("href", value)}
          />
        </FieldBlock>
      </Grid>
      <FieldBlock label="Description">
        <MenuTextInput
          value={form.description}
          onChange={(value) => onFieldChange("description", value)}
        />
      </FieldBlock>
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
        <FieldBlock label="Icon Key">
          <MenuTextInput
            value={form.iconKey}
            placeholder="CT / OV / 01"
            onChange={(value) => onFieldChange("iconKey", value)}
          />
        </FieldBlock>
        <FieldBlock label="Keywords">
          <MenuTextInput
            value={form.keywords}
            placeholder="overview, runtime"
            onChange={(value) => onFieldChange("keywords", value)}
          />
        </FieldBlock>
      </Grid>
    </>
  );
}

function MenuAccessFields({
  form,
  onFieldChange,
}: Readonly<{
  form: MenuFormState;
  onFieldChange: <Key extends keyof MenuFormState>(
    key: Key,
    value: MenuFormState[Key]
  ) => void;
}>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
      <FieldBlock label="Required Roles">
        <MenuTextInput
          value={form.requiredRoles}
          placeholder="super_admin, reviewer"
          onChange={(value) => onFieldChange("requiredRoles", value)}
        />
      </FieldBlock>
      <FieldBlock label="Required Permissions">
        <MenuTextInput
          value={form.requiredPermissions}
          placeholder="approval:read"
          onChange={(value) => onFieldChange("requiredPermissions", value)}
        />
      </FieldBlock>
    </Grid>
  );
}

function MenuTextInput({
  value,
  placeholder,
  type,
  disabled,
  onChange,
}: Readonly<{
  value: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}>) {
  return (
    <Input
      value={value}
      placeholder={placeholder}
      type={type}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      borderRadius="16px"
      h="50px"
      bg="rgba(255,255,255,0.88)"
      borderColor="rgba(99,92,82,0.16)"
    />
  );
}
