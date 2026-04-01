import type { I18nMessages } from "@/i18n/schema";

const creditsPage: I18nMessages["creditsPage"] = {
  title: "Credits",
  description: "管理你的免费 credits 和预充值 credits",
  remainingBalanceLabel: "剩余余额：",
  purchaseCredits: "购买 credits",
  walletUnavailable: "钱包不可用，请重新连接后再试。",
  signInBeforePurchase: "购买 credits 前请先完成钱包登录。",
  depositModalTitle: "购买 credits",
  depositModalDescription:
    "把 USDC 充值到 Synapse vault 中，为 API 调用补充预充值 credits。",
  currentBillingCycle: "当前 Billing 周期",
  daysRemaining: "剩余天数",
  manageSpendCapTitle: "管理消费上限",
  manageSpendCapDescription:
    "为当前 owner 账户设置月度总消费上限。达到 billing 周期上限后，新的付费 API 请求会被阻断，直到进入下一个周期。",
  manageSpendCap: "管理消费上限",
  currentSpend: "当前消费",
  billingCycleCap: "Billing 周期上限",
  billingCycleCapNotConfigured: "未配置",
  usedPercent: "已使用 {{percent}}",
  manageSpendCapCoverageHint:
    "当前没有配置 billing 周期上限。只要账户还有可用余额，就会继续扣费。",
  manageSpendCapUnavailable:
    "当前环境还没有提供 spending limit 控制能力。你仍然可以正常购买和使用 credits。",
  manageSpendCapRemainingBudget: "本 billing 周期还可消费 {{amount}}。",
  manageSpendCapModalTitle: "管理消费上限",
  manageSpendCapModalEyebrow: "Billing Cycle Spending Limit",
  manageSpendCapModalClose: "关闭消费上限弹窗",
  manageSpendCapModalAmountLabel: "金额 (USDC)",
  manageSpendCapModalHint:
    "设置一个 billing 周期内允许消费的最大金额。达到上限后，API 请求会一直被阻断，直到下一个周期开始。",
  manageSpendCapModalUnlimitedLabel: "允许无限消费",
  manageSpendCapModalUnlimitedHint:
    "不设置消费上限。你的账户会持续扣费，不做额度封顶。",
  manageSpendCapModalAmountInvalid: "请输入一个大于 0 的月度上限。",
  manageSpendCapModalSaveFailed: "保存消费上限失败。",
  manageSpendCapModalSaved: "消费上限已更新。",
  manageSpendCapModalCancel: "取消",
  manageSpendCapModalSave: "保存设置",
  freeCreditsVoucherTitle: "免费 Credits Voucher",
  freeCreditsVoucherDescription:
    "平台可能会向开发者发放免费 credits。输入 voucher 代码后，可以把免费 credits 加到你的账户。",
  redeemVoucher: "兑换 Voucher",
};

export default creditsPage;
