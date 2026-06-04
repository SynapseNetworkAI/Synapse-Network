import type { AdminRoleCatalogItem } from "@/services/admin-api";

export type RoleFormState = {
  roleKey: string;
  roleName: string;
  description: string;
  status: string;
  permissions: string[];
};

export function createEmptyRoleForm(): RoleFormState {
  return {
    roleKey: "",
    roleName: "",
    description: "",
    status: "active",
    permissions: [],
  };
}

export function createRoleFormFromCatalogItem(
  role: AdminRoleCatalogItem
): RoleFormState {
  return {
    roleKey: role.roleKey,
    roleName: role.roleName,
    description: role.description ?? "",
    status: role.status,
    permissions: role.permissions,
  };
}

export function buildRoleMutationPayload(form: RoleFormState) {
  return {
    roleName: form.roleName,
    description: form.description,
    status: form.status,
    permissions: form.permissions,
  };
}

export function buildCreateRolePayload(form: RoleFormState) {
  return {
    roleKey: form.roleKey,
    ...buildRoleMutationPayload(form),
  };
}

export function toggleRolePermission(
  permissions: string[],
  permissionKey: string
): string[] {
  if (permissions.includes(permissionKey)) {
    return permissions.filter((item) => item !== permissionKey);
  }
  return [...permissions, permissionKey].sort((left, right) =>
    left.localeCompare(right)
  );
}
