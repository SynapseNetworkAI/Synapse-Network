import type { I18nMessages } from "@/i18n/schema";

const creditsPage: I18nMessages["creditsPage"] = {
  title: "Credits",
  description: "管理你的免费 credits 和预充值 credits",
  remainingBalanceLabel: "剩余余额：",
  purchaseCredits: "购买 credits",
  currentBillingCycle: "当前 Billing 周期",
  daysRemaining: "剩余天数",
  manageSpendCapTitle: "管理消费上限",
  manageSpendCapDescription: "设置一个 billing 周期内可消费的最大金额。达到上限后，API 请求会被阻止，直到进入下一个周期。",
  manageSpendCap: "管理消费上限",
  currentSpend: "当前消费",
  billingCycleCap: "Billing 周期上限",
  usedPercent: "已使用 {{percent}}",
  freeCreditsVoucherTitle: "免费 Credits Voucher",
  freeCreditsVoucherDescription: "平台可能会向开发者发放免费 credits。输入 voucher 代码后，可以把免费 credits 加到你的账户。",
  redeemVoucher: "兑换 Voucher",
};

export default creditsPage;
