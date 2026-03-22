import type { I18nMessages } from "@/i18n/schema";

const billingPage: I18nMessages["billingPage"] = {
  title: "Owner 资金金库",
  description: "Owner 维度的资金中枢，统一查看充值、提现、退款以及钱包到金库余额。",
  note: "Provider 收益和 payout 操作归属 Provider Settlements 与 Revenue Analytics，不在这个 owner treasury 视图内。",
  vaultBalanceTitle: "Synapse 金库余额",
  vaultBalanceDescription: "可用于 API 消费或提现的真实核心资产。",
  walletBalanceTitle: "已连接钱包余额",
  walletBalanceDescription: "当前连接链上钱包里可用的 USDC。",
  refreshBalances: "刷新余额",
  noFundsFlow: "暂时还没有资金流水",
  ledgerTitle: "USDC 资金流水",
  ledgerDescription: "展示全部链上充值、提现，以及链下退款和认领记录。",
  tableTime: "时间",
  tableActionType: "动作类型",
  tableStatus: "状态",
  tableAmount: "金额 (USDC)",
  tableTransaction: "交易",
  actionDeposit: "充值",
  actionWithdraw: "提现",
  actionRefund: "退款",
  actionClaim: "认领",
  statusPending: "处理中",
  statusCompleted: "已完成",
  statusFailed: "失败",
  transactionFailed: "交易失败",
  noTransaction: "--",
};

export default billingPage;