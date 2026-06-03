export type AdminRewriteModuleKind =
  | "overview"
  | "analytics"
  | "finance"
  | "approval"
  | "provider"
  | "identity"
  | "business-control"
  | "support"
  | "audit";

export type AdminRewriteRouteMode =
  | "overview"
  | "list"
  | "crud"
  | "action"
  | "readonly"
  | "investigation";

export type AdminRewriteRouteSpec = {
  route: string;
  module: AdminRewriteModuleKind;
  title: string;
  eyebrow: string;
  description: string;
  mode: AdminRewriteRouteMode;
  primaryAction?: string;
  sections: string[];
};

export const adminRewriteRoutes: AdminRewriteRouteSpec[] = [
  {
    route: "/dashboard",
    module: "overview",
    title: "控制台入口",
    eyebrow: "Control Overview",
    description: "路由入口统一落到控制台概览，保持首屏只服务值班判断。",
    mode: "overview",
    primaryAction: "打开控制台概览",
    sections: ["默认入口", "当前值班结论", "首页重点提醒"],
  },
  {
    route: "/dashboard/overview",
    module: "overview",
    title: "控制台概览",
    eyebrow: "Control Overview",
    description: "只保留首屏判断需要的整体状态、重点队列和钻取入口。",
    mode: "overview",
    primaryAction: "查看系统状态",
    sections: ["当前值班结论", "首页重点提醒", "资金链路摘要"],
  },
  {
    route: "/dashboard/runtime",
    module: "overview",
    title: "业务运行态",
    eyebrow: "Runtime Operations",
    description:
      "把业务瓶颈、执行队列和系统运维入口拆开，避免在首页平铺所有运行时细节。",
    mode: "investigation",
    primaryAction: "进入执行队列工作台",
    sections: ["业务瓶颈", "执行队列入口", "系统运维入口"],
  },
  {
    route: "/dashboard/health",
    module: "overview",
    title: "系统健康跳转",
    eyebrow: "System Health",
    description: "兼容旧健康路由，实际系统诊断统一进入系统运维中心。",
    mode: "readonly",
    primaryAction: "打开系统运维中心",
    sections: ["兼容入口", "组件运行快照", "系统诊断明细"],
  },
  {
    route: "/system",
    module: "overview",
    title: "系统运维中心",
    eyebrow: "System Operations",
    description: "系统组件、诊断动作和运行错误统一归入只读运维工作台。",
    mode: "readonly",
    sections: ["组件运行快照", "系统诊断明细", "操作入口"],
  },
  {
    route: "/dashboard/analytics",
    module: "analytics",
    title: "Analytics 总览",
    eyebrow: "Analytics",
    description: "只做分析专题入口和关键告警，不把所有图表堆在一个页面。",
    mode: "overview",
    primaryAction: "查看调用与收入",
    sections: ["关键告警", "专题页面", "数据质量入口"],
  },
  {
    route: "/dashboard/analytics/consumer-funnel",
    module: "analytics",
    title: "Consumer 激活漏斗",
    eyebrow: "Consumer Analytics",
    description: "围绕注册、充值、调用和留存事件链路排查 Consumer 激活问题。",
    mode: "investigation",
    sections: ["事件链路", "转化阶段", "异常样本"],
  },
  {
    route: "/dashboard/analytics/data-quality",
    module: "analytics",
    title: "埋点质量",
    eyebrow: "Data Quality",
    description: "检查 source coverage、schema issue 和分析数据新鲜度。",
    mode: "readonly",
    sections: ["Source coverage", "Schema issue samples", "Freshness"],
  },
  {
    route: "/dashboard/analytics/invocation-revenue",
    module: "analytics",
    title: "调用与收入",
    eyebrow: "Invocation Revenue",
    description: "跟踪调用收入趋势、失败阶段和付费服务贡献。",
    mode: "investigation",
    sections: ["调用收入趋势", "Failure Stage", "Top services"],
  },
  {
    route: "/dashboard/analytics/money-flow",
    module: "analytics",
    title: "资金流",
    eyebrow: "Money Flow Analytics",
    description: "把充值、提现、退款和错误原因拆成资金流分析专题。",
    mode: "investigation",
    sections: ["Deposit Errors", "Withdrawal Errors", "Refund Flow"],
  },
  {
    route: "/dashboard/analytics/provider-revenue",
    module: "analytics",
    title: "Provider 收益",
    eyebrow: "Provider Revenue",
    description: "查看 provider 结算漏斗、收入排行和待提现容量。",
    mode: "investigation",
    sections: ["结算 funnel", "Top providers", "Withdrawal capacity"],
  },
  {
    route: "/dashboard/analytics/risk-health",
    module: "analytics",
    title: "风控健康",
    eyebrow: "Risk Analytics",
    description: "把风控规则、降级 provider 和异常审批集中到风险专题。",
    mode: "investigation",
    sections: ["Risk Rules", "Degraded providers", "Approval pressure"],
  },
  {
    route: "/finance",
    module: "finance",
    title: "资金概览",
    eyebrow: "Finance Desk",
    description:
      "把充值、退款、提现和平台费用分区处理，避免资金动作平铺在一个大页面。",
    mode: "list",
    primaryAction: "打开对账调查页",
    sections: ["资金总览", "Consumer Deposits", "Provider Withdrawals"],
  },
  {
    route: "/finance/reconciliation",
    module: "finance",
    title: "对账调查页",
    eyebrow: "Reconciliation",
    description: "按偏差摘要、异常队列和责任归因排查资金不一致。",
    mode: "investigation",
    sections: ["偏差调查摘要", "EXCEPTION QUEUE", "责任归因"],
  },
  {
    route: "/approvals",
    module: "approval",
    title: "审批中心",
    eyebrow: "Approval Workflow",
    description: "统一展示高风险动作，深度处理进入对应专项工作台。",
    mode: "list",
    primaryAction: "进入提现审核",
    sections: ["审批队列", "优先处理项", "审批分级"],
  },
  {
    route: "/withdrawal-reviews",
    module: "approval",
    title: "提现审核工作台",
    eyebrow: "Provider Withdrawals",
    description:
      "提现审核队列、操作注意事项和 step-up 发布动作保持独立工作台。",
    mode: "action",
    sections: ["提现审核队列", "操作注意事项", "Step-up action"],
  },
  {
    route: "/review-history",
    module: "approval",
    title: "审核历史",
    eyebrow: "Review History",
    description: "把历史审核、放行记录和 operator trail 作为只读追踪页面。",
    mode: "list",
    sections: ["审核记录", "放行记录", "Operator trail"],
  },
  {
    route: "/risk",
    module: "approval",
    title: "风控工作台",
    eyebrow: "Risk Operations",
    description: "风险模块树、风险相关审批和告警归因集中到风控工作台。",
    mode: "list",
    sections: ["风控模块树", "风险相关审批", "风险告警"],
  },
  {
    route: "/provider-services",
    module: "provider",
    title: "Provider 服务管理",
    eyebrow: "Provider Registry",
    description: "管理 provider 服务注册表、探活状态和生命周期动作。",
    mode: "list",
    primaryAction: "刷新注册表",
    sections: ["服务注册表", "探活状态", "生命周期动作"],
  },
  {
    route: "/provider-llm-config",
    module: "provider",
    title: "LLM 配置治理",
    eyebrow: "Provider LLM Control",
    description:
      "Provider、模型、定价和 rollout 动作统一放入 LLM 配置治理模块。",
    mode: "crud",
    primaryAction: "请求 staging smoke",
    sections: ["PROVIDER LLM CONTROL", "MODEL CATALOG", "ROLLOUT ACTIONS"],
  },
  {
    route: "/execution",
    module: "provider",
    title: "执行队列",
    eyebrow: "Execution Queue",
    description:
      "失败簇、执行任务和 retry 操作独立承载，不与 Provider 注册表混用。",
    mode: "list",
    sections: ["失败簇视图", "执行任务工作台", "Retry actions"],
  },
  {
    route: "/users",
    module: "identity",
    title: "后台用户与权限配置",
    eyebrow: "Identity Control",
    description: "管理员、角色、权限统一纳入 Identity & Access 模块。",
    mode: "crud",
    primaryAction: "创建后台用户",
    sections: ["管理员目录", "角色模板", "MFA 状态"],
  },
  {
    route: "/role-permissions",
    module: "identity",
    title: "角色权限管理",
    eyebrow: "RBAC",
    description: "角色、权限矩阵和模块边界统一成 RBAC CRUD 页面。",
    mode: "crud",
    primaryAction: "创建角色",
    sections: ["权限矩阵", "模块边界", "角色模板"],
  },
  {
    route: "/menu-config",
    module: "identity",
    title: "菜单配置工作台",
    eyebrow: "Backend Menu Topology",
    description: "服务端菜单拓扑、草稿与发布状态独立于业务策略配置。",
    mode: "crud",
    primaryAction: "发布菜单",
    sections: ["草稿与发布状态", "服务端菜单拓扑", "菜单项 CRUD"],
  },
  {
    route: "/config",
    module: "business-control",
    title: "配置中心",
    eyebrow: "Business Control",
    description: "只做配置入口和健康状态；编辑、运行时、发布快照进入专项页。",
    mode: "overview",
    primaryAction: "进入业务策略配置",
    sections: ["配置模块入口", "Draft / Published", "Runtime Source"],
  },
  {
    route: "/config/business-policy",
    module: "business-control",
    title: "业务策略配置",
    eyebrow: "Business Policy",
    description:
      "Finance、Consumer Withdraw、Risk、Reconciliation 分 tab 编辑 draft 并发布。",
    mode: "crud",
    primaryAction: "保存草稿",
    sections: ["Finance", "Consumer Withdraw", "Risk", "Reconciliation"],
  },
  {
    route: "/config/runtime",
    module: "business-control",
    title: "运行时来源",
    eyebrow: "Runtime Source",
    description:
      "只读展示 published、env、default 和 error 来源，secret 只显示 configured。",
    mode: "readonly",
    sections: [
      "来源分组",
      "RUNTIME / INFRA SUMMARY",
      "Secret configured state",
    ],
  },
  {
    route: "/config/published",
    module: "business-control",
    title: "已发布快照",
    eyebrow: "Published Policy",
    description: "结构化查看 published policy，原始 JSON 默认折叠。",
    mode: "readonly",
    sections: ["PUBLISHED VERSION", "Published Policy", "Raw snapshot"],
  },
  {
    route: "/owner-accounts",
    module: "business-control",
    title: "业务用户",
    eyebrow: "Owner Accounts",
    description: "Consumer / Provider owner 查询独立成业务控制只读列表。",
    mode: "list",
    sections: ["OWNER ACCOUNTS", "Consumer / Provider owner", "账户状态"],
  },
  {
    route: "/forum-support",
    module: "support",
    title: "Forum Support Operations",
    eyebrow: "Support Operations",
    description:
      "公开回复必须 human-reviewed，topic lifecycle 和回复队列分区展示。",
    mode: "action",
    primaryAction: "查看未回复队列",
    sections: ["帖子生命周期", "未回复队列", "审核并发送"],
  },
  {
    route: "/audit",
    module: "audit",
    title: "操作日志与审计追踪",
    eyebrow: "Audit & Compliance",
    description:
      "保留 operator trail、错误聚类和合规检索，不承载业务编辑动作。",
    mode: "list",
    sections: ["Immutable operator trail", "高频错误码", "合规检索"],
  },
];

export function listAdminRewriteModules(): AdminRewriteModuleKind[] {
  return Array.from(new Set(adminRewriteRoutes.map((route) => route.module)));
}

export function findAdminRewriteRoute(
  route: string
): AdminRewriteRouteSpec | null {
  return adminRewriteRoutes.find((item) => item.route === route) ?? null;
}
