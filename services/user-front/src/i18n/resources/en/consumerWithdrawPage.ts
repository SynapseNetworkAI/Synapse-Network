import type { I18nMessages } from "@/i18n/schema";

const consumerWithdrawPage: I18nMessages["consumerWithdrawPage"] = {
  title: "Withdraw",
  description:
    "Withdraw matured credits from your account back to your wallet.",
  maturityHint:
    "Recent deposits can be spent immediately, but withdrawals require T+7 matured funds.",
  activeHint: "Only one active withdrawal is allowed at a time.",
  signInTitle: "Connect wallet to withdraw",
  signInDescription:
    "Connect and sign in with your wallet before creating or continuing a withdrawal.",
  activeTitle: "Withdrawal in progress",
  reviewBody:
    "This withdrawal is under security review. We will update the status when review is complete.",
  processingBody:
    "This withdrawal is already being processed. Please wait for the status to update.",
  historyTitle: "Withdrawal history",
  historyAmount: "Amount",
  historyStatus: "Status",
  historyDate: "Date",
  historyReceipt: "Receipt",
  historyOpen: "Open",
  historyLoading: "Loading withdrawal history...",
  historyEmpty: "No withdrawals yet.",
  historyLoadFailed: "Unable to load withdrawal history right now.",
  statusCompleted: "Completed",
  statusFailed: "Failed",
  statusReview: "In review",
  statusReady: "Ready to continue",
  statusProcessing: "Processing",
};

export default consumerWithdrawPage;
