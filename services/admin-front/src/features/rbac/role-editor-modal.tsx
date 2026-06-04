"use client";

import { Box, Button, Grid, Input, Stack, Text } from "@chakra-ui/react";
import type { FormEvent } from "react";

import {
  FieldBlock,
  OverlayPanel,
  nativeFieldStyle,
} from "@/components/console-ui";
import type { AdminRoleCatalogItem } from "@/services/admin-api";

import type { RoleFormState } from "./role-form";
import type { buildPermissionGroups } from "./role-presenters";

type PermissionGroup = ReturnType<typeof buildPermissionGroups>[number];

export function RoleEditorModal({
  open,
  editingRole,
  form,
  permissionGroups,
  onClose,
  onSubmit,
  onFieldChange,
  onTogglePermission,
}: Readonly<{
  open: boolean;
  editingRole: AdminRoleCatalogItem | null;
  form: RoleFormState;
  permissionGroups: PermissionGroup[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFieldChange: <Key extends keyof RoleFormState>(
    key: Key,
    value: RoleFormState[Key]
  ) => void;
  onTogglePermission: (permissionKey: string) => void;
}>) {
  return (
    <OverlayPanel
      open={open}
      title={editingRole ? "编辑角色" : "创建角色"}
      description="角色会影响可见菜单、审批能力和高风险动作边界。"
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <Stack gap="16px">
          <RoleTextField
            label="Role Key"
            value={form.roleKey}
            disabled={editingRole !== null}
            onChange={(value) => onFieldChange("roleKey", value)}
          />
          <RoleTextField
            label="Role Name"
            value={form.roleName}
            onChange={(value) => onFieldChange("roleName", value)}
          />
          <RoleTextField
            label="Description"
            value={form.description}
            onChange={(value) => onFieldChange("description", value)}
          />
          <FieldBlock label="Status">
            <select
              value={form.status}
              onChange={(event) => onFieldChange("status", event.target.value)}
              style={nativeFieldStyle}
            >
              <option value="active">active</option>
              <option value="disabled">disabled</option>
            </select>
          </FieldBlock>
          <RolePermissionPicker
            form={form}
            permissionGroups={permissionGroups}
            onTogglePermission={onTogglePermission}
          />
          <Button
            type="submit"
            bg="brand.500"
            color="white"
            borderRadius="18px"
            h="52px"
            _hover={{ bg: "brand.600" }}
          >
            {editingRole ? "保存角色" : "创建角色"}
          </Button>
        </Stack>
      </form>
    </OverlayPanel>
  );
}

function RoleTextField({
  label,
  value,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}>) {
  return (
    <FieldBlock label={label}>
      <Input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        borderRadius="16px"
        h="50px"
        bg="rgba(255,255,255,0.88)"
        borderColor="rgba(99,92,82,0.16)"
      />
    </FieldBlock>
  );
}

function RolePermissionPicker({
  form,
  permissionGroups,
  onTogglePermission,
}: Readonly<{
  form: RoleFormState;
  permissionGroups: PermissionGroup[];
  onTogglePermission: (permissionKey: string) => void;
}>) {
  return (
    <FieldBlock label="Permissions">
      <Stack gap="12px" maxH="360px" overflowY="auto" pr="6px">
        {permissionGroups.map((group) => (
          <Box
            key={group.domain}
            borderRadius="18px"
            p="14px"
            bg="rgba(255,255,255,0.74)"
            border="1px solid rgba(99,92,82,0.10)"
          >
            <Text fontWeight="700" mb="10px">
              {group.domain}
            </Text>
            <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="8px">
              {group.items.map((permission) => (
                <Box
                  as="label"
                  key={permission.permissionKey}
                  display="flex"
                  gap="8px"
                  alignItems="flex-start"
                >
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(
                      permission.permissionKey
                    )}
                    onChange={() =>
                      onTogglePermission(permission.permissionKey)
                    }
                  />
                  <span>
                    <strong>{permission.permissionKey}</strong>
                    <span style={{ display: "block", color: "#635c52" }}>
                      {permission.description ??
                        `${permission.action} · ${permission.riskLevel}`}
                    </span>
                  </span>
                </Box>
              ))}
            </Grid>
          </Box>
        ))}
      </Stack>
    </FieldBlock>
  );
}
