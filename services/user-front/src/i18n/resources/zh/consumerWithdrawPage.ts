import type { I18nMessages } from "@/i18n/schema";

const consumerWithdrawPage: I18nMessages["consumerWithdrawPage"] = {
  title: "提现",
  description: "把已成熟 credits 从账户提回你的钱包。",
  withdrawableBalanceLabel: "可提现 credits",
  pendingWithdrawalBalanceLabel: "提现处理中的 credits",
  maturityHint:
    "只有已成熟资金才可提现。新充值的 credits 需要经过 T+7 成熟期后才可提回钱包。",
  activeHint: "同一时间只允许一笔活跃提现。",
  signInTitle: "连接钱包后提现",
  signInDescription: "创建或继续提现前，请先连接钱包并完成钱包登录。",
  activeTitle: "提现处理中",
  actionTitle: "提回钱包",
  actionDescription:
    "打开提现流程，把已成熟 credits 提回你的钱包。当前可提现：{{amount}} USDC。",
  claimReadyTitle: "领取提现",
  claimReadyDescription:
    "这笔提现已经审批通过。打开领取浮层，在链上完成 {{amount}} USDC 的提现。",
  expiringTitle: "提现授权即将过期",
  expiringBody:
    "这笔提现授权即将过期。系统会在链上安全窗口通过后，自动把资金释放回可提现余额。",
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
