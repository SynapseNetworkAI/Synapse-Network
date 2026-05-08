import type { I18nMessages } from "@/i18n/schema";

const consumerWithdrawPage: I18nMessages["consumerWithdrawPage"] = {
  title: "Withdraw",
  description:
    "Withdraw matured credits from your account back to your wallet.",
  withdrawableBalanceLabel: "Withdrawable credits",
  pendingWithdrawalBalanceLabel: "Withdrawal processing credits",
  maturityHint:
    "Only matured credits can be withdrawn. Newly deposited credits become withdrawable after the T+7 maturity window.",
  activeHint: "Only one active withdrawal is allowed at a time.",
  signInTitle: "Connect wallet to withdraw",
  signInDescription:
    "Connect and sign in with your wallet before creating or continuing a withdrawal.",
  activeTitle: "Withdrawal in progress",
  actionTitle: "Withdraw to wallet",
  actionDescription:
    "Open the withdrawal flow to send matured credits back to your wallet. Withdrawable now: {{amount}} USDC.",
  claimReadyTitle: "Claim withdrawal",
  claimReadyDescription:
    "Your withdrawal was approved. Open the claim dialog to complete the on-chain transfer for {{amount}} USDC.",
  expiringTitle: "Withdrawal approval expiring",
  expiringBody:
    "This withdrawal approval is about to expire. The system will release the funds back to your withdrawable balance after the on-chain safety window passes.",
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
