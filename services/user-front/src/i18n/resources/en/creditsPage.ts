import type { I18nMessages } from "@/i18n/schema";

const creditsPage: I18nMessages["creditsPage"] = {
  title: "Credits",
  description: "Manage your free and prepaid credits",
  remainingBalanceLabel: "Remaining balance:",
  purchaseCredits: "Purchase credits",
  walletUnavailable: "Wallet unavailable. Please reconnect and try again.",
  signInBeforePurchase: "Please sign in with wallet before purchasing credits.",
  depositModalTitle: "Purchase credits",
  depositModalDescription:
    "Deposit USDC into your Synapse vault to top up prepaid credits for API usage.",
  currentBillingCycle: "Current Billing Cycle",
  daysRemaining: "Days Remaining",
  manageSpendCapTitle: "Manage Spend Cap",
  manageSpendCapDescription:
    "Set a monthly account-level spending limit for this owner wallet. When the billing cycle cap is reached, new paid API requests will be blocked until the next cycle.",
  manageSpendCap: "Manage Spend Cap",
  currentSpend: "Current Spend",
  billingCycleCap: "Billing Cycle Cap",
  billingCycleCapNotConfigured: "Not configured",
  usedPercent: "{{percent}} used",
  manageSpendCapCoverageHint:
    "No billing cycle cap is configured. Your account can continue spending until available balance is exhausted.",
  manageSpendCapUnavailable:
    "Spending-limit controls are temporarily unavailable in this environment. Credits can still be purchased and used normally.",
  manageSpendCapRemainingBudget: "{{amount}} remaining in this billing cycle.",
  manageSpendCapModalTitle: "Manage Spending Limit",
  manageSpendCapModalEyebrow: "Billing Cycle Spending Limit",
  manageSpendCapModalClose: "Close spending limit dialog",
  manageSpendCapModalAmountLabel: "Amount (USDC)",
  manageSpendCapModalHint:
    "Set a maximum amount you can spend in a billing cycle. When reached, API requests will be blocked until the next cycle.",
  manageSpendCapModalUnlimitedLabel: "Allow unlimited spending",
  manageSpendCapModalUnlimitedHint:
    "No spending cap. Your account will continue billing without limits.",
  manageSpendCapModalAmountInvalid:
    "Enter a positive monthly limit before saving.",
  manageSpendCapModalSaveFailed: "Failed to save spending limit.",
  manageSpendCapModalSaved: "Spending limit updated.",
  manageSpendCapModalCancel: "Cancel",
  manageSpendCapModalSave: "Save Settings",
  freeCreditsVoucherTitle: "Free Credits Voucher",
  freeCreditsVoucherDescription:
    "X may give out free credits to developers to build with the API. Enter a voucher code to add free credits to your account.",
  redeemVoucher: "Redeem Voucher",
  redeemVoucherModalTitle: "Redeem Voucher Code",
  redeemVoucherModalDescription:
    "Enter your voucher to add free credits to your account.",
  redeemVoucherModalClose: "Close voucher redemption dialog",
  redeemVoucherModalPlaceholder: "XXXX-XXXX-XXXX",
  redeemVoucherModalInvalid: "Enter a voucher code in XXXX-XXXX-XXXX format.",
  redeemVoucherModalUnavailable:
    "Voucher redemption backend is not wired in this environment yet. This modal currently reserves the UI contract only.",
  redeemVoucherModalRedeeming: "Redeeming Voucher...",
  redeemVoucherModalSuccess: "Voucher redeemed. {{amount}} was added to your balance.",
  supportTitle: "Need help with deposit or billing?",
  supportDescription:
    "If credits do not arrive, a refund is stuck, or billing looks wrong, contact the operator directly before retrying the same payment flow.",
  supportAction: "Contact Support",
};

export default creditsPage;
