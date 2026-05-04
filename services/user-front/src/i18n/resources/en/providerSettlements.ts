import type { I18nMessages } from "@/i18n/schema";

const providerSettlements: I18nMessages["providerSettlements"] = {
  walletPaysGasDisconnected:
    "On-chain withdrawal, self-pay gas. Connect wallet to proceed.",
  walletPaysGasConnected: "Gas balance: {{balance}} {{symbol}}.{{estimate}}",
  walletPaysGasEstimate: " Est. gas: {{estimate}}",
  nativeTokenFallback: "native token",
  walletNoGas: "Wallet has no {{symbol}} to pay gas on {{chainLabel}}.",
  vaultLiquidityInsufficient:
    "Vault liquidity is insufficient for this withdrawal right now. The platform treasury must refill on-chain USDC before you retry.",
  vaultLiquidityCheckUnavailable:
    "Gateway cannot verify on-chain vault liquidity right now. Retry after the chain RPC reconnects.",
  chainRpcUnavailable:
    "Gateway cannot reach chain RPC right now. Retry after the RPC reconnects.",
  providerReceivableNotMatured:
    "Provider earnings need T+7 maturity before withdrawal. Newly earned receivables are visible in balance, but only matured receivables can be withdrawn.",
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
    "Withdrawal contract address is missing from the signed ticket.",
  wrongNetwork:
    "Wrong network. Switch wallet to {{chainLabel}} before resuming this withdrawal.",
  ticketExpired:
    "This withdrawal ticket has expired. Generate a new ticket before retrying.",
  ticketExpiringSoon:
    "This withdrawal credential expires in less than 2 minutes. To avoid a failed on-chain transaction and gas loss, create a new withdrawal request after this one expires.",
  gasEstimateInsufficient:
    "Withdrawal requires wallet-paid gas. Estimated max network fee is {{estimateFee}} {{symbol}}, but current wallet gas balance is {{balance}} {{symbol}}. Top up gas token before retrying.",
  walletRejected:
    "Withdrawal was cancelled in wallet. No gas fee was spent and no funds were moved.",
  insufficientNativeGas:
    "Withdrawal could not be submitted because the wallet does not have enough native token to pay gas.",
  staleTicket:
    "This withdrawal ticket is stale. Create a new withdrawal request before retrying.",
  invalidSignature:
    "This withdrawal ticket signature is no longer valid. Generate a new ticket before retrying.",
  vaultAllowanceUnavailable:
    "Vault allowance is not ready for this withdrawal yet. Retry after the platform refreshes the vault configuration.",
  contractRejectedWithName:
    "Withdrawal was rejected by the vault contract ({{name}}).",
  contractRejectedWithReason:
    "Withdrawal was rejected by the vault contract: {{reason}}.",
  generateAndClaim: "Generate & Claim",
  signerUnavailable: "Signer Unavailable",
  creatingTicket: "Creating Ticket...",
  txStateWalletPrompt: "Wallet Prompt",
  txStateConfirming: "Confirming",
  txStateFailed: "Failed",
  pendingTicketExpiredReleased:
    "Previous withdrawal ticket expired. Locked receivable has been released back to available balance.",
  pendingReviewExists:
    "A withdrawal is already pending review. Wait for review completion before creating a new one.",
  generatingTicket: "Generating signed withdrawal ticket...",
  manualReviewQueued: "Withdrawal queued for manual security review.",
  ticketGenerated: "Ticket generated. Confirm transaction in wallet.",
  withdrawalIntentCreated: "Withdrawal intent created.",
  withdrawalCreateFailed: "Failed to create provider withdrawal",
  ticketSigningUnavailable:
    "Provider withdrawals are unavailable because the gateway cannot issue signed withdrawal tickets.",
  noPendingTicket: "No pending withdrawal ticket found",
  settledCompleted: "Withdrawal settled and marked completed",
  backendCompletionFailed:
    "On-chain tx succeeded, but backend completion failed. Retry from history.",
  pendingWrongNetwork:
    "Resume Pending requires the wallet to be on {{requiredChain}}. Current wallet network is {{currentChain}}.",
  pendingTicketExpiredBanner:
    "The pending withdrawal ticket has expired. Generate a new ticket before retrying.",
  amountPlaceholder: "Amount (blank = full {{amount}} USDC)",
  resumePending: "Resume Pending",
  invalidAmountPrecision: "Use up to 2 decimal places for withdrawal amount.",
  invalidAmountValue: "Enter a valid withdrawal amount.",
  amountBelowMinimum: "Minimum withdrawal amount is {{amount}} USDC.",
  amountExceedsAvailable:
    "Amount exceeds available receivable ({{amount}} USDC).",
  withdrawAmountHint:
    "Blank = full withdrawal. Minimum withdrawal: {{amount}} USDC. Max 2 decimals.",
  loadingHistory: "Loading withdrawal history...",
  expiredTicketReleasedRow:
    "Expired ticket released back to available balance.",
  txSubmitted: "Tx submitted: {{hash}}...",
  title: "Settlement Pipeline",
  description: "Provider reconciliation & on-chain self-service withdrawal.",
  providerWithdrawalEyebrow: "Provider Withdrawal (Self-pay Gas)",
  withdrawalTitle: "Claim Receivable to Wallet via EIP-712 Ticket",
  withdrawalDescription:
    "Gateway issues EIP-712 ticket; provider claims on-chain, self-pay gas.",
  chainRequiredNetwork: "the required network",
  metricAvailable: "Available",
  metricGasBalance: "Gas Balance",
  metricPendingLocked: "Pending / Locked",
  metricPendingTicket: "Pending Ticket",
  metricTxState: "Tx State",
  securityContractTitle: "Security Contract",
  securityBulletOne: "One pending ticket per owner.",
  securityBulletTwo: "Intent atomically locks receivable into providersLocked.",
  securityBulletThree:
    "Completion consumes lock once; txHash-bound idempotent finalize.",
  securityBulletFour:
    "EIP-712 ticketId+deadline; contract enforces one-time ticketHash replay protection.",
  searchRequestPlaceholder: "Search Request ID",
  searchServicePlaceholder: "Search Service (fuzzy)",
  searchButton: "Search",
  summaryNetEarned: "Net Earned",
  summaryGrossEarnings: "Gross Earnings",
  summaryProtocolFee: "Protocol Fee",
  summaryRoutingTax: "Routing Tax",
  eventsTableRequestId: "Request ID",
  eventsTableService: "Service",
  eventsTableGross: "Gross",
  eventsTableProtocolFee: "Protocol Fee",
  eventsTableRoutingTax: "Routing Tax",
  eventsTableNet: "Net",
  eventsTableCallTime: "Call Time",
  eventsTableEmpty: "No settlement events yet.",
  unknownService: "unknown",
  historyTitle: "Withdrawal History",
  historyDescription: "Includes expired-released tickets as cancelled rows.",
  historyFilterAll: "All",
  historyStatusRequested: "Requested",
  historyStatusApprovedAuto: "Ticket Ready",
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
  dedupeNote: "Deduplicated by request ID before aggregation.",
  descriptionTip:
    "Reconciled provider payouts from gateway settlement logs, with self-service on-chain withdrawal and ticket-based replay protection.",
  withdrawalDescriptionTip:
    "Gateway issues a signed withdrawal ticket; provider submits the on-chain withdraw transaction and pays gas. Pending tickets lock receivable to prevent duplicate withdrawal and replay at ledger layer.",
  walletGasTip:
    "Withdrawals are on-chain transactions. The connected wallet signs the claim and pays native gas.",
  withdrawAmountHintTip:
    "Leave amount blank to withdraw the full available receivable. Any active ticket moves funds from Available into Pending / Locked; if the on-chain claim never succeeds, the locked amount is automatically released back to Available in about 6 minutes by default. Custom amount supports up to 2 decimal places.",
  historyDescriptionTip:
    "Includes expired tickets released back to available balance as explicit cancelled history rows.",
  dedupeNoteTip:
    "Requests are deduplicated by request ID before summary aggregation to prevent double-counting across retries.",
  withdrawPageTitle: "Provider Withdraw",
  withdrawPageDescription: "EIP-712 on-chain self-service withdrawal.",
  withdrawAmountLabel: "Withdraw Amount",
  confirmWithdraw: "Confirm",
  withdrawAmountPlaceholder: "Amount (blank = full withdrawal)",
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
