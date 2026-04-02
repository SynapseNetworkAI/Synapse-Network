import type { AdminPermissionCatalogItem, AdminRoleCatalogItem } from "@/services/admin-api";

type SentinelTone = "green" | "orange" | "red" | "gray";

export function buildPermissionGroups(permissions: AdminPermissionCatalogItem[]) {
  const groups = new Map<string, AdminPermissionCatalogItem[]>();
  permissions.forEach((permission) => {
    const current = groups.get(permission.resourceDomain) ?? [];
    current.push(permission);
    groups.set(permission.resourceDomain, [...current].sort((left, right) => left.permissionKey.localeCompare(right.permissionKey)));
  });

  return Array.from(groups.entries())
    .map(([domain, items]) => ({ domain, items }))
    .sort((left, right) => left.domain.localeCompare(right.domain));
}

export function filterRoles(items: AdminRoleCatalogItem[], search: string, statusFilter: string): AdminRoleCatalogItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((role) => {
    const matchesSearch = !normalizedSearch
      || role.roleKey.toLowerCase().includes(normalizedSearch)
      || role.roleName.toLowerCase().includes(normalizedSearch)
      || (role.description ?? "").toLowerCase().includes(normalizedSearch);
    const matchesStatus = statusFilter === "all" || role.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
}

export function sortRolesByPriority(items: AdminRoleCatalogItem[]): AdminRoleCatalogItem[] {
  const weight = (role: AdminRoleCatalogItem) => {
    let score = role.permissions.length;
    if (role.status === "active") {
      score += 100;
    }
    if (role.roleKey.includes("super") || role.roleKey.includes("admin")) {
      score += 20;
    }
    return score;
  };

  return [...items].sort((left, right) => {
    const weightDifference = weight(right) - weight(left);
    if (weightDifference !== 0) {
      return weightDifference;
    }
    return left.roleName.localeCompare(right.roleName);
  });
}

export function buildRoleMetrics(roles: AdminRoleCatalogItem[], permissions: AdminPermissionCatalogItem[]) {
  const activeCount = roles.filter((role) => role.status === "active").length;
  const disabledCount = roles.filter((role) => role.status === "disabled").length;
  const maxPermissionCount = roles.reduce((max, role) => Math.max(max, role.permissions.length), 0);
  const coveredPermissionCount = new Set(roles.flatMap((role) => role.permissions)).size;

  return {
    totalRoles: roles.length,
    activeCount,
    disabledCount,
    maxPermissionCount,
    coveredPermissionCount,
    uncoveredPermissionCount: Math.max(permissions.length - coveredPermissionCount, 0),
  };
}

export function buildRoleDomainCards(roles: AdminRoleCatalogItem[], permissions: AdminPermissionCatalogItem[]) {
  const domainMap = new Map<string, { key: string; label: string; permissionCount: number; coveredCount: number; activeRoleCount: number }>();

  permissions.forEach((permission) => {
    const entry = domainMap.get(permission.resourceDomain) ?? {
      key: permission.resourceDomain.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-"),
      label: permission.resourceDomain,
      permissionCount: 0,
      coveredCount: 0,
      activeRoleCount: 0,
    };
    entry.permissionCount += 1;
    domainMap.set(permission.resourceDomain, entry);
  });

  domainMap.forEach((entry, domain) => {
    const permissionsInDomain = permissions.filter((permission) => permission.resourceDomain === domain).map((permission) => permission.permissionKey);
    const activeRoles = roles.filter((role) => role.status === "active" && role.permissions.some((permissionKey) => permissionsInDomain.includes(permissionKey)));
    const covered = permissionsInDomain.filter((permissionKey) => roles.some((role) => role.permissions.includes(permissionKey)));
    entry.coveredCount = covered.length;
    entry.activeRoleCount = activeRoles.length;
  });

  return [...domainMap.values()].sort((left, right) => right.permissionCount - left.permissionCount || left.label.localeCompare(right.label));
}

export function buildRoleRiskCards(roles: AdminRoleCatalogItem[]) {
  return sortRolesByPriority(roles).slice(0, 4).map((role) => ({
    key: role.roleKey,
    label: role.roleName,
    roleKey: role.roleKey,
    permissionCount: role.permissions.length,
    description: role.description ?? "No description",
    tone: (role.status === "active" ? "orange" : "gray") as SentinelTone,
  }));
}