import type { I18nMessages } from "@/i18n/schema";

const providerSettlements: I18nMessages["providerSettlements"] = {
  walletPaysGasDisconnected:
    "On-chain withdrawal, self-pay gas. Connect wallet to proceed.",
  walletPaysGasConnected: "Gas balance: {{balance}} {{symbol}}.{{estimate}}",
  walletPaysGasEstimate: " Est. gas: {{estimate}}",
  nativeTokenFallback: "native token",
  walletNoGas: "Wallet has no {{symbol}} to pay gas on {{chainLabel}}.",
  vaultLiquidityInsufficient:
    "The on-chain withdrawal reserve cannot cover this amount right now. Please retry later.",
  vaultLiquidityCheckUnavailable:
    "We cannot verify withdrawal availability right now. Please retry in a moment.",
  chainRpcUnavailable:
    "The withdrawal network is temporarily unavailable. Please retry in a moment.",
  providerReceivableNotMatured:
    "Provider earnings are still in the T+7 maturity window. Only matured receivables can be withdrawn; newly earned receivables still appear in balance.",
  minWithdrawalAmountNotMet:
    "Minimum provider withdrawal amount is 10.00 USDC.",
  insufficientProviderReceivable:
    "Withdrawable provider receivable is insufficient for this withdrawal.",
  pendingWithdrawalExists:
    "A provider withdrawal is already pending. Complete it or wait for review before creating a new one.",
  vaultAddressMissing: "Vault contract address missing",
  walletClientUnavailable:
    "Network client unavailable. Reconnect wallet and retry the withdrawal.",
  connectWalletFirst: "Connect wallet before submitting this withdrawal.",
  withdrawalContractMissing:
    "Withdrawals are not available in this environment yet.",
  wrongNetwork:
    "Wrong network. Switch wallet to {{chainLabel}} before resuming this withdrawal.",
  ticketExpired:
    "This withdrawal approval has expired. Create a new withdrawal request before retrying.",
  ticketExpiringSoon:
    "This withdrawal approval expires soon. Wait a moment, then create a new withdrawal request to avoid a failed transaction.",
  gasEstimateInsufficient:
    "Withdrawal requires wallet-paid gas. Estimated max network fee is {{estimateFee}} {{symbol}}, but current wallet gas balance is {{balance}} {{symbol}}. Top up gas token before retrying.",
  walletRejected:
    "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved.",
  insufficientNativeGas:
    "Withdrawal could not be submitted because the wallet does not have enough native token to pay gas.",
  staleTicket:
    "This withdrawal approval is no longer valid. Create a new withdrawal request before retrying.",
  invalidSignature:
    "This withdrawal approval is no longer valid. Create a new withdrawal request before retrying.",
  vaultAllowanceUnavailable:
    "Withdrawal authorization is not ready yet. Please retry in a moment.",
  contractRejectedWithName:
    "The on-chain withdrawal was rejected. No funds were moved.",
  contractRejectedWithReason:
    "The on-chain withdrawal was rejected. No funds were moved.",
  generateAndClaim: "Generate & Claim",
  signerUnavailable: "Signer Unavailable",
  creatingTicket: "Preparing...",
  txStateWalletPrompt: "Wallet Prompt",
  txStateConfirming: "Confirming",
  txStateFailed: "Failed",
  pendingTicketExpiredReleased:
    "The previous withdrawal request expired. Locked receivable has been returned to your withdrawable balance.",
  pendingReviewExists:
    "A withdrawal is already pending review. Wait for review completion before creating a new one.",
  generatingTicket: "Preparing withdrawal...",
  manualReviewQueued: "Withdrawal queued for manual security review.",
  ticketGenerated:
    "Withdrawal is ready. Confirm the transaction in your wallet.",
  withdrawalIntentCreated: "Withdrawal request created.",
  withdrawalCreateFailed:
    "Unable to prepare this withdrawal. Please retry in a moment.",
  ticketSigningUnavailable:
    "Provider withdrawals are temporarily unavailable. Please retry later.",
  noPendingTicket: "No pending withdrawal found",
  settledCompleted: "Withdrawal completed",
  backendCompletionFailed:
    "Withdrawal was submitted. Your records are syncing; contact support if the status does not update soon.",
  pendingWrongNetwork:
    "To continue this withdrawal, switch your wallet to {{requiredChain}}. Current wallet network is {{currentChain}}.",
  pendingTicketExpiredBanner:
    "The pending withdrawal expired. Create a new withdrawal request before retrying.",
  resumePending: "Continue Withdrawal",
  invalidAmountPrecision: "Use up to 2 decimal places for withdrawal amount.",
  invalidAmountValue: "Enter a valid withdrawal amount.",
  amountBelowMinimum: "Minimum withdrawal amount is {{amount}} USDC.",
  amountExceedsAvailable:
    "Amount exceeds available receivable ({{amount}} USDC).",
  withdrawAmountHint: "Minimum withdrawal: {{amount}} USDC",
  withdrawableReceivable: "Withdrawable receivable",
  receivableBalance: "Receivable balance",
  immatureReceivableNotice:
    "Newly earned receivables appear in balance first, then enter withdrawable receivable after T+7.",
  matureReceivableBelowMinimumTitle:
    "Matured withdrawable amount is below the 10.00 USDC minimum",
  loadingHistory: "Loading withdrawal history...",
  expiredTicketReleasedRow:
    "Expired withdrawal released back to withdrawable balance.",
  txSubmitted: "Tx submitted: {{hash}}...",
  title: "Settlement Pipeline",
  description: "Provider reconciliation & on-chain self-service withdrawal.",
  providerWithdrawalEyebrow: "Provider Withdrawal (Self-pay Gas)",
  withdrawalTitle: "Withdraw receivable to wallet",
  withdrawalDescription:
    "Confirm the withdrawal in your wallet and pay gas on-chain.",
  chainRequiredNetwork: "the required network",
  metricAvailable: "Available",
  metricGasBalance: "Gas Balance",
  metricPendingLocked: "Pending / Locked",
  metricPendingTicket: "Pending Withdrawal",
  metricTxState: "Tx State",
  searchRequestPlaceholder: "Search record",
  searchServicePlaceholder: "Search Service (fuzzy)",
  searchButton: "Search",
  summaryNetEarned: "Net Earned",
  summaryGrossEarnings: "Gross Earnings",
  summaryProtocolFee: "Protocol Fee",
  summaryRoutingTax: "Routing Tax",
  eventsTableRequestId: "Record",
  eventsTableService: "Service",
  eventsTableGross: "Gross",
  eventsTableProtocolFee: "Protocol Fee",
  eventsTableRoutingTax: "Routing Tax",
  eventsTableNet: "Net",
  eventsTableCallTime: "Call Time",
  eventsTableEmpty: "No settlement events yet.",
  unknownService: "unknown",
  historyTitle: "Withdrawal History",
  historyDescription:
    "Includes expired withdrawals returned to your withdrawable balance.",
  historyFilterAll: "All",
  historyStatusRequested: "Requested",
  historyStatusApprovedAuto: "Ready to Claim",
  historyStatusPendingManualReview: "Manual Review",
  historyStatusCompleted: "Completed",
  historyStatusRejected: "Rejected",
  historyStatusCancelled: "Cancelled / Released",
  historyStatusFailedExpired: "Expired / Released",
  historyTableWithdrawalId: "Withdrawal ID",
  historyTableAmount: "Amount",
  historyTableStatus: "Status",
  historyTableReason: "Reason",
  historyTableNonce: "Nonce",
  historyTableCreated: "Created",
  historyTableTxHash: "Tx Hash",
  historyEmpty: "No withdrawal records yet.",
  historyFilteredEmpty: "No {{status}} records match the current filter.",
  loadHistoryFailed: "Failed to load withdrawal history",
  paginationShowing: "Showing {{start}}-{{end}} of {{total}}",
  paginationPrev: "Prev",
  paginationNext: "Next",
  dedupeNote: "Duplicate retries are safely merged.",
  descriptionTip:
    "Review provider earnings, fees, and self-service on-chain withdrawals.",
  withdrawalDescriptionTip:
    "A pending withdrawal temporarily locks the selected receivable so the same funds cannot be withdrawn twice.",
  walletGasTip:
    "Withdrawals are on-chain transactions. The connected wallet signs the claim and pays native gas.",
  withdrawAmountHintTip:
    "Any active withdrawal temporarily locks the selected amount. If it is not completed, the amount is automatically returned to your withdrawable balance.",
  historyDescriptionTip:
    "Includes expired withdrawals returned to your withdrawable balance.",
  dedupeNoteTip:
    "Retry attempts are grouped before summary totals so one business action is not counted twice.",
  withdrawPageTitle: "Provider Withdraw",
  withdrawPageDescription: "EIP-712 on-chain self-service withdrawal.",
  withdrawAmountLabel: "Withdraw Amount",
  confirmWithdraw: "Confirm",
  withdrawAmountPlaceholder: "Amount",
  withdrawGasNote:
    "On-chain transaction — a small gas fee in native token (e.g. ETH) applies. Minimum withdrawal: {{amount}} USDC.",
  insufficientGasWarning:
    "Insufficient gas balance. Please top up native token (e.g. ETH) in your wallet before withdrawing.",
  historyPageTitle: "Withdraw History",
  historyPageDescription: "Settlement events and withdrawal history.",
  viewHistory: "View History",
  viewInvocationRecords: "View Invocation Records",
  invocationRecordsTitle: "Invocation Records",
  invocationRecordsDescription:
    "Settlement events from provider service invocations.",
  backToWithdraw: "Back to Withdraw",
};

export default providerSettlements;
