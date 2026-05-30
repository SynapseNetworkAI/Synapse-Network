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

type NavLookupRecord = {
  label: string;
  description: string;
};

const hiddenNavigationItemIds = new Set(["dashboard-system-health"]);

const legacyPathByItemId: Record<string, string> = {
  "dashboard-overview": "/dashboard/overview",
  "dashboard-runtime": "/dashboard/runtime",
  "dashboard-analytics": "/dashboard/analytics",
  "analytics-consumer-funnel": "/dashboard/analytics/consumer-funnel",
  "analytics-invocation-revenue": "/dashboard/analytics/invocation-revenue",
  "analytics-provider-revenue": "/dashboard/analytics/provider-revenue",
  "analytics-money-flow": "/dashboard/analytics/money-flow",
  "analytics-risk-health": "/dashboard/analytics/risk-health",
  "analytics-data-quality": "/dashboard/analytics/data-quality",
};

const navLookupById: Record<string, NavLookupRecord> = {
  dashboard: { label: "控制台", description: "总览与业务运行态入口。" },
  analytics: {
    label: "Analytics",
    description: "增长、收入、风控与埋点质量观测。",
  },
  "dashboard-analytics": {
    label: "Analytics 总览",
    description: "North Star 指标、关键告警与专题入口。",
  },
  "analytics-consumer-funnel": {
    label: "Consumer 激活漏斗",
    description: "从访问到首次调用的增长漏斗。",
  },
  "analytics-invocation-revenue": {
    label: "调用与收入",
    description: "quote、invoke、GMV、失败归因与延迟。",
  },
  "analytics-provider-revenue": {
    label: "Provider 收益",
    description: "Provider 收入、首次收益与结算 funnel。",
  },
  "analytics-money-flow": {
    label: "资金流",
    description: "充值、提现、退款、确认延迟与 ledger context。",
  },
  "analytics-risk-health": {
    label: "风控健康",
    description: "risk rules、budget blocked 与 provider degraded。",
  },
  "analytics-data-quality": {
    label: "埋点质量",
    description: "事件量、source coverage、隐私检查与 schema issue。",
  },
  execution: {
    label: "执行队列",
    description: "审批后的任务排队、重试与执行状态。",
  },
  "provider-services": {
    label: "Provider 服务",
    description: "注册服务、探活状态与自动摘流管理。",
  },
  "forum-support": {
    label: "社区回复",
    description: "未回复帖子、Agent 建议回复与人工发送。",
  },
  system: { label: "系统运维", description: "Gateway、Indexer 与对账运行态。" },
  users: { label: "后台用户", description: "管理员目录、状态与 MFA 要求。" },
  "role-permissions": {
    label: "角色权限",
    description: "权限矩阵、模块边界与 reviewer 分工。",
  },
  "menu-config": {
    label: "菜单配置",
    description: "后台已发布导航的拓扑与治理。",
  },
  "config-center": {
    label: "配置中心",
    description: "业务策略参数的草稿、已发布版本与运行时来源总览。",
  },
  approvals: { label: "审批中心", description: "高风险动作审批与审核状态流。" },
  "withdrawal-reviews": {
    label: "提现复核",
    description: "出金审核与风险复核台。",
  },
  "review-history": {
    label: "审核历史",
    description: "已审批、已拒绝与已释放结果回看。",
  },
  "owner-accounts": {
    label: "业务用户",
    description: "Consumer / Provider owner、钱包和邮箱验证状态。",
  },
  finance: { label: "财务控制", description: "充值、扣费、退款与责任敞口。" },
  risk: { label: "风险控制", description: "风险信号、策略与异常处置。" },
  audit: { label: "审计追踪", description: "操作留痕、追踪检索与审计检视。" },
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

function mergeLookup(item: NavItem): NavItem {
  return {
    ...item,
    title: item.title,
    description: item.description,
  };
}

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
  const visual = getNavVisual(item.itemId);
  const legacyPath = legacyPathByItemId[item.itemId];
  const path =
    item.nodeType === "page" || item.nodeType === "panel" || legacyPath
      ? item.href ?? legacyPath
      : undefined;
  return mergeLookup({
    id: item.itemId,
    title: item.label,
    icon: item.iconKey || visual.icon,
    path,
    description: item.description || item.sectionDescription || visual.kicker,
    nodeType: item.nodeType,
    searchKeywords: [
      item.sectionLabel,
      item.sectionDescription,
      item.label,
      item.description,
      ...item.keywords,
    ].filter(Boolean),
  });
}

function buildFallbackItems(items: AdminMenuConfigItem[]): NavItem[] {
  const fallbackChildren = [...items]
    .sort(compareMenuItems)
    .map((item) => toNavItem(item));

  if (fallbackChildren.length === 0) {
    return [];
  }

  return [
    {
      id: "other-modules",
      title: "其他模块",
      icon: "OT",
      description: "来自服务端配置但未在 Sentinel IA 中显式建模的页面。",
      children: fallbackChildren,
    },
  ];
}

export function buildAdminNavigation(items: AdminMenuConfigItem[]): NavItem[] {
  if (items.length === 0) {
    return [];
  }

  const sortedItems = items
    .filter((item) => !hiddenNavigationItemIds.has(item.itemId))
    .sort(compareMenuItems);
  const byId = new Map(
    sortedItems.map((item) => [item.itemId, toNavItem(item)])
  );
  const roots: NavItem[] = [];
  const fallbackItems: AdminMenuConfigItem[] = [];

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
      fallbackItems.push(item);
      return;
    }

    parent.children = [...(parent.children ?? []), navItem];
  });

  return roots.concat(buildFallbackItems(fallbackItems));
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

export function getNavVisual(itemId: string): { icon: string; kicker: string } {
  const lookup = navLookupById[itemId];
  return lookup
    ? { icon: itemId.slice(0, 2).toUpperCase(), kicker: lookup.description }
    : { icon: "SN", kicker: "control module" };
}
