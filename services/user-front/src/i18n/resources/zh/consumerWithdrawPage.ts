import type { I18nMessages } from "@/i18n/schema";

const consumerWithdrawPage: I18nMessages["consumerWithdrawPage"] = {
  title: "提现",
  description: "把已成熟 credits 从账户提回你的钱包。",
  maturityHint: "近期充值可立即用于 API 消费，但提现需要 T+7 资金成熟期。",
  activeHint: "同一时间只允许一笔活跃提现。",
  signInTitle: "连接钱包后提现",
  signInDescription: "创建或继续提现前，请先连接钱包并完成钱包登录。",
  activeTitle: "提现处理中",
  reviewBody: "这笔提现已进入安全审核。审核完成后，我们会更新状态。",
  processingBody: "这笔提现正在处理中，请等待状态更新。",
  historyTitle: "提现历史",
  historyAmount: "金额",
  historyStatus: "状态",
  historyDate: "日期",
  historyReceipt: "凭证",
  historyOpen: "打开",
  historyLoading: "正在加载提现历史...",
  historyEmpty: "暂无提现记录。",
  historyLoadFailed: "暂时无法加载提现历史。",
  statusCompleted: "已完成",
  statusFailed: "失败",
  statusReview: "审核中",
  statusReady: "可继续提现",
  statusProcessing: "处理中",
};

export default consumerWithdrawPage;
