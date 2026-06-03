import type {
  AdminProfile,
  AdminRoleCatalogItem,
  AdminUserItem,
} from "@/services/admin-api";

export type UserFormState = {
  email: string;
  displayName: string;
  roleKey: string;
  password: string;
  requireMfa: boolean;
  status: string;
};

export type AdminUserMetrics = ReturnType<typeof buildAdminUserMetrics>;

export type RoleSnapshot = ReturnType<typeof buildRoleSnapshots>[number];

export function createEmptyUserForm(roleKey = ""): UserFormState {
  return {
    email: "",
    displayName: "",
    roleKey,
    password: "",
    requireMfa: true,
    status: "active",
  };
}

export function buildUserEditForm(user: AdminUserItem): UserFormState {
  return {
    email: user.email,
    displayName: user.displayName,
    roleKey: user.roleKeys[0] ?? "",
    password: "",
    requireMfa: user.requireMfa,
    status: user.status,
  };
}

export function buildAdminUserCreateInput(form: UserFormState) {
  return {
    email: form.email.trim(),
    displayName: form.displayName.trim(),
    roleKey: form.roleKey,
    password: form.password,
    requireMfa: form.requireMfa,
    status: form.status,
  };
}

export function buildAdminUserUpdateInput(form: UserFormState) {
  const password = form.password.trim();

  return {
    displayName: form.displayName.trim(),
    roleKey: form.roleKey,
    password: password || undefined,
    requireMfa: form.requireMfa,
    status: form.status,
  };
}

export function filterAdminUsers(
  users: AdminUserItem[],
  search: string,
  roleFilter: string,
  statusFilter: string
): AdminUserItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return users.filter((user) => {
    const matchesSearch =
      !normalizedSearch ||
      user.email.toLowerCase().includes(normalizedSearch) ||
      user.displayName.toLowerCase().includes(normalizedSearch) ||
      user.roleKeys.some((role) =>
        role.toLowerCase().includes(normalizedSearch)
      );
    const matchesRole =
      roleFilter === "all" || user.roleKeys.includes(roleFilter);
    const matchesStatus =
      statusFilter === "all" || user.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });
}

export function buildAdminUserMetrics(users: AdminUserItem[]) {
  const active = users.filter((user) => user.status === "active").length;
  const disabled = users.filter((user) => user.status === "disabled").length;
  const requireMfa = users.filter((user) => user.requireMfa).length;
  const privileged = users.filter((user) =>
    user.roleKeys.some(isPrivilegedRoleKey)
  ).length;

  return {
    total: users.length,
    active,
    disabled,
    requireMfa,
    privileged,
  };
}

export function buildRoleSnapshots(
  users: AdminUserItem[],
  roles: AdminRoleCatalogItem[]
) {
  return roles.map((role) => ({
    roleKey: role.roleKey,
    roleName: role.roleName,
    status: role.status,
    permissionCount: role.permissions.length,
    assignedUsers: users.filter((user) => user.roleKeys.includes(role.roleKey))
      .length,
  }));
}

export function summarizePermissions(permissions: string[], maxVisible = 3) {
  return {
    visible: permissions.slice(0, maxVisible),
    hiddenCount: Math.max(permissions.length - maxVisible, 0),
  };
}

export function formatAdminUserTimestamp(value: string | null): string {
  return value ?? "Never";
}

export function canManageAdminUsers(admin: AdminProfile | null): boolean {
  return admin?.role === "super_admin";
}

export function buildUserMutationError(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error ? error.message : fallback;
}

function isPrivilegedRoleKey(roleKey: string): boolean {
  return (
    roleKey.includes("super") ||
    roleKey.includes("finance") ||
    roleKey.includes("review")
  );
}
