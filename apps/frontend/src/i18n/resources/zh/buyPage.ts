import type { I18nMessages } from "@/i18n/schema";

const buyPage: I18nMessages["buyPage"] = {
  title: "购买工作台",
  description: "面向调用方：总钱包充值担保，签发 Agent Credential，并把一次性 API key secret 分发给真实运行中的 agent。",
  step1Title: "步骤 1 · 充值担保（全局资金池）",
  step1Action: "打开 Owner Treasury",
  ownerWalletLabel: "全局钱包地址 (Owner)",
  ownerWalletDisconnected: "未连接钱包",
  poolBalanceLabel: "可用资金池余额 (USDC)",
  step2Title: "步骤 2 · Agent Credentials",
  step2Action: "打开 Agent Credentials",
  step2Description: "Agent Credential 是 owner 为运行时签发的访问身份；创建成功后系统只展示一次对应的 API key secret。所有该钱包下 credential 产生的消费都会自动汇总到当前资金池。",
  step2DiscoveryAction: "发现并调用 API",
  step3Title: "步骤 3 · 费用核对（Owner Treasury）",
  step3Action: "打开资金账本",
  step3Description: "所有执行单元使用的 API Key 调用产生的扣费账单，最终都会汇聚在 Owner 总钱包下统一展现与核销。在 Owner Treasury 里你可以查看、导出完整的聚合交易流水。",
};

export default buyPage;