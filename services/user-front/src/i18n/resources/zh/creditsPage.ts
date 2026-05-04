import type { I18nMessages } from "@/i18n/schema";

const creditsPage: I18nMessages["creditsPage"] = {
  title: "Credits",
  description: "管理你的免费 credits 和预充值 credits",
  remainingBalanceLabel: "可消费 credits：",
  spendableBalanceLabel: "可消费 credits",
  pendingBalanceLabel: "同步中的 credits",
  frozenBalanceLabel: "冻结 / 审核中的 credits",
  pendingBalanceHint:
    "链上已提交或确认，正在等待 Gateway 索引后转为 Agent 可消费余额。",
  frozenBalanceHint: "资金已因活跃提现、人工审核或风控规则被锁定。",
  purchaseCredits: "购买 credits",
  walletUnavailable: "钱包不可用，请重新连接后再试。",
  signInBeforePurchase: "购买 credits 前请先完成钱包登录。",
  depositModalTitle: "购买 credits",
  depositModalDescription:
    "把 USDC 充值到 Synapse vault 中，为 API 调用补充预充值 credits。",
  depositConfirmationNotice:
    "区块链确认中，余额通常会在 1-2 分钟内到账。你可以保持页面打开，或稍后刷新。",
  depositAmountLabel: "金额 (USDC)",
  depositWalletUsdcLabel: "钱包 USDC",
  depositNativeGasLabel: "Gas 余额",
  depositNetworkLabel: "网络",
  depositTransactionSummary: "交易摘要",
  depositFromWallet: "来源钱包",
  depositToVault: "目标 Vault 合约",
  depositAmountSummary: "充值金额",
  depositPermitAllowance: "本次授权额度",
  depositExpectationTitle: "确认前请核对",
  depositExpectationPermit: "Permit 签名本身免 gas，并且只授权本次 USDC 金额。",
  depositExpectationGas: "Vault 充值是链上交易，需要使用原生代币支付 gas。",
  depositExpectationSync:
    "Gateway 索引并确认充值后，资金才会转为可消费 credits。",
  depositPermitStepTitle: "Step 1: Permit 授权",
  depositPermitStepActive: "钱包弹窗：为精确金额签署免 gas 授权。",
  depositPermitStepDone: "Permit 签名已完成。",
  depositVaultStepTitle: "Step 2: Vault 充值交易",
  depositVaultStepActive: "钱包弹窗：提交链上 Vault 充值交易并支付 gas。",
  depositVaultStepWaiting: "等待 Permit 授权完成。",
  depositCancel: "取消",
  depositProcessing: "处理中...",
  depositConfirm: "确认充值",
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
  redeemVoucherModalTitle: "兑换 Voucher Code",
  redeemVoucherModalDescription:
    "输入 voucher code，把免费 credits 充入你的账户。",
  redeemVoucherModalClose: "关闭 voucher 兑换弹窗",
  redeemVoucherModalPlaceholder: "XXXX-XXXX-XXXX",
  redeemVoucherModalInvalid: "请输入 `XXXX-XXXX-XXXX` 格式的 voucher code。",
  redeemVoucherModalUnavailable:
    "当前环境还没有接通 voucher 核销后端。现在先把 UI 契约和输入校验收口，后端上线后可直接接入。",
  redeemVoucherModalRedeeming: "正在兑换 Voucher...",
  redeemVoucherModalSuccess: "Voucher 核销成功，{{amount}} 已充入你的余额。",
  supportTitle: "充值或计费遇到问题？",
  supportDescription:
    "如果 credits 没到账、退款卡住，或者账单结果异常，请直接联系运营，不要重复发起同一笔支付操作。",
  supportAction: "联系支持",
};

export default creditsPage;
