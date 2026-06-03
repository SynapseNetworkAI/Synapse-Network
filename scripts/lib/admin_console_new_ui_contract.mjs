export const ADMIN_CONSOLE_ROUTE_SPECS = [
  {
    route: "/approvals",
    expectedTexts: ["审批中心", "审批队列", "优先处理项"],
  },
  {
    route: "/audit",
    expectedTexts: [
      "操作日志与审计追踪",
      "Immutable operator trail",
      "高频错误码",
    ],
  },
  {
    route: "/config",
    expectedTexts: ["配置中心", "配置模块入口", "业务策略配置"],
  },
  {
    route: "/config/business-policy",
    expectedTexts: ["业务策略配置", "Finance", "Consumer Withdraw", "保存草稿"],
  },
  {
    route: "/config/published",
    expectedTexts: ["已发布快照", "PUBLISHED VERSION", "Published Policy"],
  },
  {
    route: "/config/runtime",
    expectedTexts: ["运行时来源", "来源分组", "RUNTIME / INFRA SUMMARY"],
  },
  {
    route: "/dashboard",
    expectedPath: "/dashboard/overview",
    expectedTexts: ["控制台概览", "首页重点提醒", "资金链路摘要"],
  },
  {
    route: "/dashboard/analytics",
    expectedTexts: ["Analytics 总览", "关键告警", "专题页面"],
  },
  {
    route: "/dashboard/analytics/consumer-funnel",
    expectedTexts: ["Consumer 激活漏斗", "事件链路"],
  },
  {
    route: "/dashboard/analytics/data-quality",
    expectedTexts: ["埋点质量", "Source coverage", "Schema issue samples"],
  },
  {
    route: "/dashboard/analytics/invocation-revenue",
    expectedTexts: ["调用与收入", "调用收入趋势", "Failure Stage"],
  },
  {
    route: "/dashboard/analytics/money-flow",
    expectedTexts: ["资金流", "Deposit Errors", "Withdrawal Errors"],
  },
  {
    route: "/dashboard/analytics/provider-revenue",
    expectedTexts: ["Provider 收益", "结算 funnel", "Top providers"],
  },
  {
    route: "/dashboard/analytics/risk-health",
    expectedTexts: ["风控健康", "Risk Rules", "Degraded providers"],
  },
  {
    route: "/dashboard/health",
    expectedPath: "/system",
    expectedTexts: ["系统运维中心", "组件运行快照", "系统诊断明细"],
  },
  {
    route: "/dashboard/overview",
    expectedTexts: ["控制台概览", "首页重点提醒", "资金链路摘要"],
  },
  {
    route: "/dashboard/runtime",
    expectedTexts: ["业务运行态", "查看系统运维状态", "进入执行队列工作台"],
  },
  {
    route: "/execution",
    expectedTexts: ["执行队列", "失败簇视图", "执行任务工作台"],
  },
  {
    route: "/finance",
    expectedTexts: ["资金概览", "Overview", "今天的资金变化"],
  },
  {
    route: "/finance/reconciliation",
    expectedTexts: ["对账调查页", "偏差调查摘要", "EXCEPTION QUEUE"],
  },
  {
    route: "/forum-support",
    expectedTexts: ["Forum Support Operations", "帖子生命周期", "未回复队列"],
  },
  {
    route: "/menu-config",
    expectedTexts: ["菜单配置工作台", "草稿与发布状态", "服务端菜单拓扑"],
  },
  {
    route: "/owner-accounts",
    expectedTexts: ["业务用户", "OWNER ACCOUNTS", "Consumer / Provider owner"],
  },
  {
    route: "/provider-llm-config",
    expectedTexts: ["LLM 配置治理", "PROVIDER LLM CONTROL", "MODEL CATALOG"],
  },
  {
    route: "/provider-services",
    expectedTexts: [
      "Provider 服务管理",
      "GATEWAY PROVIDER REGISTRY",
      "服务注册表",
    ],
  },
  {
    route: "/review-history",
    expectedTexts: ["审核历史", "审核记录", "放行记录"],
  },
  {
    route: "/risk",
    expectedTexts: ["风控工作台", "风控模块树", "风险相关审批"],
  },
  {
    route: "/role-permissions",
    expectedTexts: ["角色权限管理", "权限矩阵", "模块边界"],
  },
  {
    route: "/system",
    expectedTexts: ["系统运维中心", "组件运行快照", "系统诊断明细"],
  },
  {
    route: "/users",
    expectedTexts: ["后台用户与权限配置", "管理员目录"],
  },
  {
    route: "/withdrawal-reviews",
    expectedTexts: ["提现审核工作台", "提现审核队列", "操作注意事项"],
  },
];

export function adminConsoleRouteSpecs() {
  return ADMIN_CONSOLE_ROUTE_SPECS.map((spec) => ({
    expectedPath: spec.expectedPath ?? spec.route,
    ...spec,
  }));
}
