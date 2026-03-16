import type { AdminMenuConfigItem, AdminProfile } from "@/services/admin-api";


export type AdminNavNode = {
  id: string;
  href: string;
  label: string;
  description: string;
  badge?: string;
  requiredPermissions?: string[];
  requiredRoles?: string[];
};

export type AdminNavSection = {
  id: string;
  label: string;
  description: string;
  children: AdminNavNode[];
};


export const adminNavigationTree: AdminNavSection[] = [
  {
    id: "overview",
    label: "控制总览",
    description: "稳定读模型、控制台总览与核心运营信号。",
    children: [
      {
        id: "dashboard",
        href: "/dashboard",
        label: "控制台",
        description: "总览 finance、activity、operations 3 个稳定读模型。",
        requiredPermissions: ["dashboard:read"],
      },
    ],
  },
  {
    id: "identity-access",
    label: "身份与权限",
    description: "后台用户、角色模板、菜单树与权限矩阵。",
    children: [
      {
        id: "users",
        href: "/users",
        label: "后台用户",
        description: "创建管理员、分配角色、查看权限模板与启用状态。",
        requiredRoles: ["super_admin", "platform_ops_admin"],
      },
      {
        id: "role-permissions",
        href: "/role-permissions",
        label: "角色权限",
        description: "查看角色权限矩阵、模块权限边界与 reviewer 分工。",
        requiredRoles: ["super_admin", "platform_ops_admin"],
      },
      {
        id: "menu-config",
        href: "/menu-config",
        label: "菜单配置",
        description: "菜单树、路由、可见性和权限依赖的配置视图。",
        requiredRoles: ["super_admin", "platform_ops_admin"],
      },
      {
        id: "execution",
        href: "/execution",
        label: "执行队列",
        description: "查看 execution jobs、失败重试与网关执行结果。",
        requiredPermissions: ["execution:read"],
      },
    ],
  },
  {
    id: "ops-controls",
    label: "业务控制",
    description: "审批、资金、风控和系统运维的受控操作入口。",
    children: [
      {
        id: "approvals",
        href: "/approvals",
        label: "审批中心",
        description: "高风险动作审批流、reviewer 决策与执行前守门。",
        badge: "flow",
        requiredPermissions: ["approval:read"],
      },
      {
        id: "finance",
        href: "/finance",
        label: "资金运营",
        description: "充值异常、退款与提现控制面，聚焦受控动作。",
        requiredPermissions: ["dashboard:read"],
      },
      {
        id: "risk",
        href: "/risk",
        label: "风控工作台",
        description: "风险规则、工单分流、黑白名单与风险标签处置。",
        requiredPermissions: ["dashboard:read"],
      },
      {
        id: "system",
        href: "/system",
        label: "系统运维",
        description: "gateway、indexer、reconciliation 与运行时参数快照。",
        requiredPermissions: ["dashboard:read"],
      },
    ],
  },
  {
    id: "audit-ledger",
    label: "审计合规",
    description: "操作日志、审计回放与高风险动作追踪。",
    children: [
      {
        id: "audit",
        href: "/audit",
        label: "操作日志",
        description: "管理员操作日志、审批链路和失败告警审计检索。",
        requiredPermissions: ["audit:read"],
      },
    ],
  },
];


function canAccessItem(admin: AdminProfile, item: AdminNavNode): boolean {
  const roleAllowed = !item.requiredRoles || item.requiredRoles.includes(admin.role);
  const permissionAllowed = !item.requiredPermissions || item.requiredPermissions.every((permission) => admin.permissions.includes(permission));
  return roleAllowed && permissionAllowed;
}


function buildSectionsFromConfig(items: AdminMenuConfigItem[], fallback: AdminNavSection[]): AdminNavSection[] {
  if (items.length === 0) {
    return fallback;
  }

  const sections = new Map<string, AdminNavSection>();

  items
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .forEach((item) => {
      const currentSection = sections.get(item.sectionId);
      const node: AdminNavNode = {
        id: item.itemId,
        href: item.href,
        label: item.label,
        description: item.description,
        requiredRoles: item.requiredRoles,
        requiredPermissions: item.requiredPermissions,
      };

      if (currentSection) {
        currentSection.children.push(node);
        return;
      }

      sections.set(item.sectionId, {
        id: item.sectionId,
        label: item.sectionLabel,
        description: item.sectionDescription,
        children: [node],
      });
    });

  return Array.from(sections.values());
}


export function getVisibleAdminNavigation(admin: AdminProfile): AdminNavSection[] {
  return getVisibleAdminNavigationFromConfig(admin, [], adminNavigationTree);
}


export function getVisibleAdminNavigationFromConfig(
  admin: AdminProfile,
  items: AdminMenuConfigItem[],
  fallback: AdminNavSection[] = adminNavigationTree,
): AdminNavSection[] {
  return buildSectionsFromConfig(items, fallback)
    .map((section) => ({
      ...section,
      children: section.children.filter((item) => canAccessItem(admin, item)),
    }))
    .filter((section) => section.children.length > 0);
}
