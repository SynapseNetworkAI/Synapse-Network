import type { AdminMenuConfigItem, AdminMenuConfigMeta } from "@/services/admin-api";

type SentinelTone = "green" | "orange" | "red" | "gray";

export function filterMenuItems(items: AdminMenuConfigItem[], search: string, sectionFilter: string): AdminMenuConfigItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    const matchesSearch = !normalizedSearch
      || item.label.toLowerCase().includes(normalizedSearch)
      || (item.href ?? "").toLowerCase().includes(normalizedSearch)
      || item.sectionLabel.toLowerCase().includes(normalizedSearch)
      || item.itemId.toLowerCase().includes(normalizedSearch)
      || (item.parentItemId ?? "").toLowerCase().includes(normalizedSearch)
      || item.nodeType.toLowerCase().includes(normalizedSearch)
      || item.iconKey.toLowerCase().includes(normalizedSearch)
      || item.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedSearch));
    const matchesSection = sectionFilter === "all" || item.sectionId === sectionFilter;
    return matchesSearch && matchesSection;
  });
}

export function buildMenuSections(items: AdminMenuConfigItem[]) {
  const map = new Map<string, { id: string; label: string; count: number }>();
  items.forEach((item) => {
    const section = map.get(item.sectionId) ?? { id: item.sectionId, label: item.sectionLabel, count: 0 };
    section.count += 1;
    map.set(item.sectionId, section);
  });
  return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label));
}

export function sortMenuItemsByTopology(items: AdminMenuConfigItem[]): AdminMenuConfigItem[] {
  return [...items].sort((left, right) => {
    const sectionDifference = left.sectionLabel.localeCompare(right.sectionLabel);
    if (sectionDifference !== 0) {
      return sectionDifference;
    }
    const orderDifference = left.sortOrder - right.sortOrder;
    if (orderDifference !== 0) {
      return orderDifference;
    }
    const parentDifference = (left.parentItemId ?? "").localeCompare(right.parentItemId ?? "");
    if (parentDifference !== 0) {
      return parentDifference;
    }
    return left.label.localeCompare(right.label);
  });
}

export function buildMenuMetrics(items: AdminMenuConfigItem[], meta: AdminMenuConfigMeta | null) {
  const gatedByRoleCount = items.filter((item) => item.requiredRoles.length > 0).length;
  const gatedByPermissionCount = items.filter((item) => item.requiredPermissions.length > 0).length;
  const multiGatedCount = items.filter((item) => item.requiredRoles.length > 0 && item.requiredPermissions.length > 0).length;

  return {
    totalItems: items.length,
    sectionCount: new Set(items.map((item) => item.sectionId)).size,
    gatedByRoleCount,
    gatedByPermissionCount,
    multiGatedCount,
    isDirty: meta?.isDirty ?? false,
  };
}

export function buildMenuVersionCards(meta: AdminMenuConfigMeta | null) {
  if (!meta) {
    return [];
  }

  return [
    {
      key: "draft",
      label: "Draft version",
      value: `v${meta.draftVersion}`,
      description: meta.updatedAt ? `updated ${meta.updatedAt}` : "draft timestamp unavailable",
      tone: (meta.isDirty ? "orange" : "green") as SentinelTone,
    },
    {
      key: "published",
      label: "Published version",
      value: `v${meta.publishedVersion}`,
      description: meta.publishedAt ? `published ${meta.publishedAt}` : "publish timestamp unavailable",
      tone: (meta.isDirty ? "gray" : "green") as SentinelTone,
    },
  ];
}

export function buildMenuGateCards(items: AdminMenuConfigItem[]) {
  return buildMenuSections(items).slice(0, 4).map((section) => {
    const rows = items.filter((item) => item.sectionId === section.id);
    return {
      key: section.id,
      label: section.label,
      totalCount: rows.length,
      roleGateCount: rows.filter((row) => row.requiredRoles.length > 0).length,
      permissionGateCount: rows.filter((row) => row.requiredPermissions.length > 0).length,
    };
  });
}