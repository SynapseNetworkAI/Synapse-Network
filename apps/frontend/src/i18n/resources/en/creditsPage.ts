import type { I18nMessages } from "@/i18n/schema";

const creditsPage: I18nMessages["creditsPage"] = {
  title: "Credits",
  description: "Manage your free and prepaid credits",
  remainingBalanceLabel: "Remaining balance:",
  purchaseCredits: "Purchase credits",
  walletUnavailable: "Wallet unavailable. Please reconnect and try again.",
  signInBeforePurchase: "Please sign in with wallet before purchasing credits.",
  depositModalTitle: "Purchase credits",
  depositModalDescription: "Deposit USDC into your Synapse vault to top up prepaid credits for API usage.",
  currentBillingCycle: "Current Billing Cycle",
  daysRemaining: "Days Remaining",
  manageSpendCapTitle: "Manage Spend Cap",
  manageSpendCapDescription: "Set a maximum amount you can spend in a billing cycle. When reached, API requests will be blocked until the next cycle.",
  manageSpendCap: "Manage Spend Cap",
  currentSpend: "Current Spend",
  billingCycleCap: "Billing Cycle Cap",
  usedPercent: "{{percent}} used",
  freeCreditsVoucherTitle: "Free Credits Voucher",
  freeCreditsVoucherDescription: "X may give out free credits to developers to build with the API. Enter a voucher code to add free credits to your account.",
  redeemVoucher: "Redeem Voucher",
};

export default creditsPage;
