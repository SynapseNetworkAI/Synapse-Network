"use client";

import { Button, Grid, Input, Stack } from "@chakra-ui/react";
import type { FormEvent } from "react";

import {
  FieldBlock,
  OverlayPanel,
  nativeFieldStyle,
} from "@/components/console-ui";
import type { AdminRoleCatalogItem, AdminUserItem } from "@/services/admin-api";

import type { UserFormState } from "./user-presenters";

type UserFormUpdater = (
  updater: (current: UserFormState) => UserFormState
) => void;

export function UserEditorModal({
  editingUser,
  form,
  roles,
  setForm,
  submitting,
  submitUserForm,
}: Readonly<{
  editingUser: AdminUserItem | null;
  form: UserFormState;
  roles: AdminRoleCatalogItem[];
  setForm: UserFormUpdater;
  submitting: boolean;
  submitUserForm: () => Promise<void>;
}>) {
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUserForm();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <Stack gap="16px">
        <UserEmailField
          disabled={editingUser !== null}
          form={form}
          setForm={setForm}
        />
        <UserDisplayNameField form={form} setForm={setForm} />
        <UserRoleField form={form} roles={roles} setForm={setForm} />
        <UserPasswordField
          editing={editingUser !== null}
          form={form}
          setForm={setForm}
        />
        <UserAccessStateFields form={form} setForm={setForm} />
        <Button
          type="submit"
          bg="brand.500"
          color="white"
          borderRadius="18px"
          h="52px"
          _hover={{ bg: "brand.600" }}
          loading={submitting}
        >
          {editingUser ? "保存修改" : "创建管理员"}
        </Button>
      </Stack>
    </form>
  );
}

function UserEmailField({
  disabled,
  form,
  setForm,
}: Readonly<{
  disabled: boolean;
  form: UserFormState;
  setForm: UserFormUpdater;
}>) {
  return (
    <FieldBlock label="Email">
      <Input
        value={form.email}
        onChange={(event) =>
          setForm((current) => ({ ...current, email: event.target.value }))
        }
        disabled={disabled}
        {...adminUserInputProps}
      />
    </FieldBlock>
  );
}

function UserDisplayNameField({
  form,
  setForm,
}: Readonly<{ form: UserFormState; setForm: UserFormUpdater }>) {
  return (
    <FieldBlock label="Display Name">
      <Input
        value={form.displayName}
        onChange={(event) =>
          setForm((current) => ({
            ...current,
            displayName: event.target.value,
          }))
        }
        {...adminUserInputProps}
      />
    </FieldBlock>
  );
}

function UserRoleField({
  form,
  roles,
  setForm,
}: Readonly<{
  form: UserFormState;
  roles: AdminRoleCatalogItem[];
  setForm: UserFormUpdater;
}>) {
  return (
    <FieldBlock label="Role Template">
      <select
        value={form.roleKey}
        onChange={(event) =>
          setForm((current) => ({ ...current, roleKey: event.target.value }))
        }
        style={nativeFieldStyle}
      >
        <option value="">选择角色</option>
        {roles.map((role) => (
          <option key={role.roleKey} value={role.roleKey}>
            {role.roleName}
          </option>
        ))}
      </select>
    </FieldBlock>
  );
}

function UserPasswordField({
  editing,
  form,
  setForm,
}: Readonly<{
  editing: boolean;
  form: UserFormState;
  setForm: UserFormUpdater;
}>) {
  return (
    <FieldBlock
      label="Password"
      hint={editing ? "留空表示不变更密码。" : "创建用户时必须提供初始密码。"}
    >
      <Input
        value={form.password}
        onChange={(event) =>
          setForm((current) => ({ ...current, password: event.target.value }))
        }
        type="password"
        {...adminUserInputProps}
      />
    </FieldBlock>
  );
}

function UserAccessStateFields({
  form,
  setForm,
}: Readonly<{ form: UserFormState; setForm: UserFormUpdater }>) {
  return (
    <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="16px">
      <UserStatusField form={form} setForm={setForm} />
      <UserMfaField form={form} setForm={setForm} />
    </Grid>
  );
}

function UserStatusField({
  form,
  setForm,
}: Readonly<{ form: UserFormState; setForm: UserFormUpdater }>) {
  return (
    <FieldBlock label="Status">
      <select
        value={form.status}
        onChange={(event) =>
          setForm((current) => ({ ...current, status: event.target.value }))
        }
        style={nativeFieldStyle}
      >
        <option value="active">active</option>
        <option value="disabled">disabled</option>
      </select>
    </FieldBlock>
  );
}

function UserMfaField({
  form,
  setForm,
}: Readonly<{ form: UserFormState; setForm: UserFormUpdater }>) {
  return (
    <FieldBlock label="MFA">
      <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <input
          type="checkbox"
          checked={form.requireMfa}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              requireMfa: event.target.checked,
            }))
          }
        />
        <span>Require Google Authenticator</span>
      </label>
    </FieldBlock>
  );
}

const adminUserInputProps = {
  bg: "rgba(255,255,255,0.88)",
  borderColor: "rgba(99,92,82,0.16)",
  borderRadius: "16px",
  h: "50px",
} as const;

export function UserEditorOverlay({
  editingUser,
  form,
  isOpen,
  onClose,
  roles,
  setForm,
  submitting,
  submitUserForm,
}: Readonly<{
  editingUser: AdminUserItem | null;
  form: UserFormState;
  isOpen: boolean;
  onClose: () => void;
  roles: AdminRoleCatalogItem[];
  setForm: UserFormUpdater;
  submitting: boolean;
  submitUserForm: () => Promise<void>;
}>) {
  return (
    <OverlayPanel
      open={isOpen}
      title={editingUser ? "编辑管理员" : "创建管理员"}
      description="变更会直接写入 gateway-admin 用户目录，并影响会话、角色和菜单可见性。"
      onClose={onClose}
    >
      <UserEditorModal
        editingUser={editingUser}
        form={form}
        roles={roles}
        setForm={setForm}
        submitting={submitting}
        submitUserForm={submitUserForm}
      />
    </OverlayPanel>
  );
}
