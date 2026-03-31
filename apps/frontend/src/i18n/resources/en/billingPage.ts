import type { I18nMessages } from "@/i18n/schema";

const billingPage: I18nMessages["billingPage"] = {
  title: "Owner Treasury",
  description: "Owner-scoped funds center for deposits, withdrawals, refunds, and wallet-to-vault balances.",
  note: "Provider earnings and payout operations live in Provider Settlements and Revenue Analytics, not in this owner treasury view.",
  openCredits: "Open Credits",
  vaultBalanceTitle: "Synapse Vault Balance",
  vaultBalanceDescription: "Real core assets available for API spend or withdrawal.",
  walletBalanceTitle: "Connected Wallet Balance",
  walletBalanceDescription: "Available USDC currently sitting in the connected on-chain wallet.",
  refreshBalances: "Refresh balances",
  noFundsFlow: "No funds flow yet",
  ledgerTitle: "USDC Funds Ledger",
  ledgerDescription: "Showing all on-chain deposits and withdrawals, plus off-chain refunds and claims.",
  tableTime: "Time",
  tableActionType: "Action Type",
  tableStatus: "Status",
  tableAmount: "Amount (USDC)",
  tableTransaction: "Transaction",
  actionDeposit: "Deposit",
  actionWithdraw: "Withdraw",
  actionRefund: "Refund",
  actionClaim: "Claim",
  statusPending: "Pending",
  statusCompleted: "Completed",
  statusFailed: "Failed",
  transactionFailed: "Transaction failed",
  noTransaction: "--",
};

export default billingPage;
