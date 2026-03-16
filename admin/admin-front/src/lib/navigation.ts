export type AdminNavItem = {
  href: string;
  label: string;
  badge?: string;
};

export const adminNavigation: AdminNavItem[] = [
  { href: "/dashboard", label: "控制台" },
  { href: "/approvals", label: "审批中心", badge: "12" },
  { href: "/login", label: "管理员登录" },
];
