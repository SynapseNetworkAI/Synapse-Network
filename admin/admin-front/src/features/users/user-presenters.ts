import type { AdminRoleCatalogItem, AdminUserItem } from "@/services/admin-api";

export function filterAdminUsers(users: AdminUserItem[], search: string, roleFilter: string, statusFilter: string): AdminUserItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return users.filter((user) => {
    const matchesSearch = !normalizedSearch
      || user.email.toLowerCase().includes(normalizedSearch)
      || user.displayName.toLowerCase().includes(normalizedSearch)
      || user.roleKeys.some((role) => role.toLowerCase().includes(normalizedSearch));
    const matchesRole = roleFilter === "all" || user.roleKeys.includes(roleFilter);
    const matchesStatus = statusFilter === "all" || user.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });
}

export function buildAdminUserMetrics(users: AdminUserItem[]) {
  const active = users.filter((user) => user.status === "active").length;
  const disabled = users.filter((user) => user.status === "disabled").length;
  const requireMfa = users.filter((user) => user.requireMfa).length;
  const privileged = users.filter((user) => user.roleKeys.some((roleKey) => roleKey.includes("super") || roleKey.includes("finance") || roleKey.includes("review"))).length;

  return {
    total: users.length,
    active,
    disabled,
    requireMfa,
    privileged,
  };
}

export function buildRoleSnapshots(users: AdminUserItem[], roles: AdminRoleCatalogItem[]) {
  return roles.map((role) => ({
    roleKey: role.roleKey,
    roleName: role.roleName,
    status: role.status,
    permissionCount: role.permissions.length,
    assignedUsers: users.filter((user) => user.roleKeys.includes(role.roleKey)).length,
  }));
}

export function summarizePermissions(permissions: string[], maxVisible = 3) {
  return {
    visible: permissions.slice(0, maxVisible),
    hiddenCount: Math.max(permissions.length - maxVisible, 0),
  };
}