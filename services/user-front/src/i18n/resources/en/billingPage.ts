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
  tablePaymentMethod: "Payment Method",
  tableAmount: "Amount",
  tableDate: "Date",
  tableInvoice: "Invoice",
  transactionHashLabel: "Transaction hash",
  openTransactionExplorer: "Open transaction explorer",
  statusPending: "Pending",
  statusPendingSyncing: "Pending / Syncing",
  statusWithdrawPending: "Withdrawal processing",
  statusSucceeded: "Completed",
  statusFailed: "Failed",
  depositStatusHint:
    "Completed means Gateway credited spendable balance, not only chain confirmation.",
  loading: "Loading payments...",
  empty: "No payment activity found for the selected range.",
};

export default billingPage;
