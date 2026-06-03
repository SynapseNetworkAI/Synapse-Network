import type { AdminMenuConfigItem } from "@/services/admin-api";

export type NavItem = {
  id: string;
  title: string;
  icon: string;
  path?: string;
  description?: string;
  nodeType?: "category" | "page" | "panel";
  searchKeywords?: string[];
  children?: NavItem[];
};

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

type ResolveExpandedNavigationIdsOptions = {
  manualExpandedIds: string[];
  manualCollapsedIds: string[];
  activePath: string[];
  filteredExpandedIds: string[];
  query: string;
};

const defaultExpandedNavigationIds = ["control-overview", "dashboard"];

function compareMenuItems(
  left: AdminMenuConfigItem,
  right: AdminMenuConfigItem
): number {
  const sortDifference = left.sortOrder - right.sortOrder;
  if (sortDifference !== 0) {
    return sortDifference;
  }
  const sectionDifference = left.sectionLabel.localeCompare(right.sectionLabel);
  if (sectionDifference !== 0) {
    return sectionDifference;
  }
  const parentDifference = (left.parentItemId ?? "").localeCompare(
    right.parentItemId ?? ""
  );
  if (parentDifference !== 0) {
    return parentDifference;
  }
  return left.label.localeCompare(right.label);
}

function toNavItem(item: AdminMenuConfigItem): NavItem {
  const path =
    item.nodeType === "page" || item.nodeType === "panel"
      ? item.href ?? undefined
      : undefined;
  return {
    id: item.itemId,
    title: item.label,
    icon: item.iconKey || "SN",
    path,
    description: item.description || item.sectionDescription,
    nodeType: item.nodeType,
    searchKeywords: [
      item.sectionLabel,
      item.sectionDescription,
      item.label,
      item.description,
      ...item.keywords,
    ].filter(Boolean),
  };
}

export function buildAdminNavigation(items: AdminMenuConfigItem[]): NavItem[] {
  if (items.length === 0) {
    return [];
  }

  const sortedItems = [...items].sort(compareMenuItems);
  const byId = new Map(
    sortedItems.map((item) => [item.itemId, toNavItem(item)])
  );
  const roots: NavItem[] = [];

  sortedItems.forEach((item) => {
    const navItem = byId.get(item.itemId);
    if (!navItem) {
      return;
    }

    if (!item.parentItemId) {
      roots.push(navItem);
      return;
    }

    const parent = byId.get(item.parentItemId);
    if (!parent) {
      return;
    }

    parent.children = [...(parent.children ?? []), navItem];
  });

  return roots;
}

export function findNavPathByPath(
  items: NavItem[],
  pathname: string
): string[] {
  for (const item of items) {
    const childPath = item.children
      ? findNavPathByPath(item.children, pathname)
      : [];
    if (childPath.length > 0) {
      return [item.id, ...childPath];
    }

    if (item.path === pathname) {
      return [item.id];
    }
  }

  return [];
}

export function findNavItemByPath(
  items: NavItem[],
  pathname: string
): NavItem | null {
  for (const item of items) {
    if (item.path === pathname) {
      return item;
    }

    if (item.children) {
      const childItem = findNavItemByPath(item.children, pathname);
      if (childItem) {
        return childItem;
      }
    }
  }

  return null;
}

export function filterNavigation(
  items: NavItem[],
  query: string
): { filtered: NavItem[]; expandedIds: string[] } {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return { filtered: items, expandedIds: [] };
  }

  const expandedIds = new Set<string>();

  function visit(node: NavItem): NavItem | null {
    const haystack = [
      node.title,
      node.description,
      node.path,
      ...(node.searchKeywords ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const directMatch = haystack.includes(normalizedQuery);
    const filteredChildren = node.children
      ?.map((child) => visit(child))
      .filter((child): child is NavItem => child !== null);

    if (!directMatch && (!filteredChildren || filteredChildren.length === 0)) {
      return null;
    }

    if (filteredChildren && filteredChildren.length > 0) {
      expandedIds.add(node.id);
    }

    return {
      ...node,
      children: filteredChildren,
    };
  }

  return {
    filtered: items
      .map((item) => visit(item))
      .filter((item): item is NavItem => item !== null),
    expandedIds: Array.from(expandedIds),
  };
}

export function resolveExpandedNavigationIds({
  manualExpandedIds,
  manualCollapsedIds,
  activePath,
  filteredExpandedIds,
  query,
}: ResolveExpandedNavigationIdsOptions): string[] {
  const expandedIds = new Set<string>([
    ...defaultExpandedNavigationIds,
    ...manualExpandedIds,
    ...activePath,
    ...filteredExpandedIds,
  ]);

  if (!normalizeQuery(query)) {
    for (const id of manualCollapsedIds) {
      expandedIds.delete(id);
    }
  }

  return Array.from(expandedIds);
}
