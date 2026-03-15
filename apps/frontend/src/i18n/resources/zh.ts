import type { I18nMessages } from "@/i18n/schema";

const zh: I18nMessages = {
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
  },
  home: {
    heroTitle: "AI 智能体的结算层",
    heroSubtitle: "面向智能体的 API 结算网关（Stripe for AI Agents）。让机器之间实现零 Gas、毫秒级服务买卖与结算。",
    heroTagline: "智能体已经会交流，现在它们可以交易。",
    buyerBtn: "买家接入",
    providerBtn: "卖家控制台",
    providerTitle: "面向卖家",
    providerHeadline: "写一次，全球变现。",
    providerBody: "注册 API 并设置单次价格，每次被调用都可自动获得 USDC 收益。",
    consumerTitle: "面向买家",
    consumerHeadline: "一个 API Key，调用全网算力。",
    consumerBody: "一次充值 USDC 担保后，Agent 可跨服务按次调用，统一账单与结算。",
    explore: "探索",
    islandTitle: "Every agent is an island. Until now.",
    islandBody: "Synapse 把“会调用 API”升级为“可交易 API”，让交互变成可清算的资金流。",
    problemTitle: "当前问题",
    solutionTitle: "我们的解法",
    problemItems: [
      "Agent 会推理会编码，但没有原生支付能力。",
      "机器之间微支付经常断层，最终退回人工付款。",
      "逐笔链上支付在高频调用下又慢又贵。",
    ],
    solutionItems: [
      "赋予 Agent 自主消费和赚钱能力，且全程可审计。",
      "通过链下网关实现毫秒级扣费，适配高频调用。",
      "以链上 USDC 作为担保与清算，单次调用边际 Gas 接近 0。",
    ],
    safetyTitle: "担保资金安全",
    safetyBody: "买家资金先进入链上 Vault，所有结算由合约规则可验证地约束。",
    speedTitle: "高频低延迟",
    speedBody: "调用扣费在网关侧离链完成，Agent 可承载突发流量而不受逐笔上链限制。",
    transparencyTitle: "费用透明",
    transparencyBody: "每次调用都展示平台抽成、卖家净收入和余额变化，支持审计与对账。",
    registryTitle: "已注册服务列表",
    registryBody: "给用户和 Agent 的实时服务清单：调用前可直接查看 serviceId、价格与地址。",
    registryEmpty: "当前暂无已注册服务，请在卖家控制台发布后展示。",
    loadingServices: "正在加载服务注册表...",
    startBuilding: "立即开始",
    finalLine: "Synapse 不是聊天插件，而是机器经济的结算底层。",
    serviceIdLabel: "服务 ID",
  },
  blogPage: {
    title: "博客",
    description: "Synapse Network 的产品更新、架构笔记与发布日志将在这里发布。",
  },
  aboutPage: {
    title: "关于 Synapse Network",
    description: "Synapse Network 是面向 AI 智能体的结算基础设施：链上 USDC 担保、链下毫秒扣费、全链路可审计。",
  },
};

export default zh;
