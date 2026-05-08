import type { I18nMessages } from "@/i18n/schema";

const billingPage: I18nMessages["billingPage"] = {
  title: "Payments",
  description:
    "View all billing transactions and payment history for your account",
  fromLabel: "FROM",
  toLabel: "TO",
  resetRange: "Reset to last 3 months",
  tableTransactionId: "Transaction ID",
  tableStatus: "Status",
  tableType: "Type",
  tablePaymentMethod: "Payment Method",
  tableAmount: "Amount",
  tableDate: "Date",
  tableInvoice: "Invoice",
  actionDeposit: "Deposit",
  actionWithdraw: "Withdraw",
  actionRefund: "Refund",
  actionClaim: "Claim",
  paymentMethodWallet: "Wallet",
  paymentMethodVoucher: "Voucher",
  transactionHashLabel: "Transaction hash",
  openTransactionExplorer: "Open transaction explorer",
  statusPending: "Pending",
  statusPendingSyncing: "Pending / Syncing",
  statusWithdrawReviewPending: "Under review",
  statusWithdrawReadyToClaim: "Ready to claim",
  statusWithdrawPending: "Withdrawal processing",
  statusSucceeded: "Completed",
  statusFailed: "Failed",
  depositStatusHint:
    "Completed means Gateway credited spendable balance, not only chain confirmation.",
  networkFeeHint:
    "Network gas is paid by your wallet in the chain's native token. Use the explorer link to inspect gas details.",
  historyLimitHint:
    "Showing the latest {{count}} records. Contact support if you need a full export.",
  datePickerLocale: "en-US",
  datePickerPreviousMonth: "Previous month",
  datePickerNextMonth: "Next month",
  datePickerToday: "Today",
  loading: "Loading payments...",
  empty: "No payment activity found for the selected range.",
};

export default billingPage;
