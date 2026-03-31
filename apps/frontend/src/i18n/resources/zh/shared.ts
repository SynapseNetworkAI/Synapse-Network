import type { I18nMessages } from "@/i18n/schema";

const shared: Pick<I18nMessages, "language" | "nav" | "sidebar"> = {
  language: {
    en: "英文",
    zh: "中文",
  },
  nav: {
    apiMarketplace: "API 市场",
    blog: "博客",
    about: "关于",
    gatewayNode: "网关节点",
    online: "在线",
    offline: "离线",
    checking: "检测中...",
    disconnect: "断开连接",
    disconnectWallet: "断开钱包连接",
    walletDisconnected: "钱包已断开连接",
  },
  sidebar: {
    ownerControl: "Owner 控制面",
    overview: "总览",
    agents: "Agents",
    agentsWorkspace: "Agents Workspace",
    credits: "Credits",
    discovery: "服务发现",
    invocations: "调用记录",
    treasury: "资金库",
    riskAudit: "风险与审计",
    developerResources: "开发者资源",
    providerRole: "Provider 角色",
    providerConsole: "Provider 控制台",
    providerCredentials: "Provider 凭据",
    myServices: "我的服务",
    usageAnalytics: "使用分析",
    settlements: "结算",
  },
};

export default shared;
