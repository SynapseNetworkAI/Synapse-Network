export const TRANSLATIONS: Record<string, string> = {
  "providerSettlements.withdrawPageTitle": "Provider Withdraw",
  "providerSettlements.withdrawPageDescription":
    "EIP-712 on-chain self-service withdrawal.",
  "providerSettlements.metricAvailable": "Available",
  "providerSettlements.withdrawableReceivable": "Withdrawable receivable",
  "providerSettlements.receivableBalance": "Receivable balance",
  "providerSettlements.immatureReceivableNotice":
    "Newly earned receivables appear in balance first, then enter withdrawable receivable after T+7.",
  "providerSettlements.matureReceivableBelowMinimumTitle":
    "Matured withdrawable amount is below the 10.00 USDC minimum",
  "providerSettlements.generateAndClaim": "Generate & Claim",
  "providerSettlements.signerUnavailable": "Signer Unavailable",
  "providerSettlements.creatingTicket": "Preparing...",
  "providerSettlements.resumePending": "Resume Pending",
  "providerSettlements.withdrawAmountLabel": "Withdraw Amount",
  "providerSettlements.withdrawGasNote":
    "On-chain transaction — a small gas fee in native token (e.g. ETH) applies.",
  "providerSettlements.insufficientGasWarning":
    "Insufficient gas balance. Please top up native token.",
  "providerSettlements.historyTitle": "Withdrawal History",
  "providerSettlements.historyFilterAll": "All",
  "providerSettlements.historyStatusRequested": "Requested",
  "providerSettlements.historyStatusApprovedAuto": "Ready to Claim",
  "providerSettlements.historyStatusPendingManualReview": "Manual Review",
  "providerSettlements.historyStatusCompleted": "Completed",
  "providerSettlements.historyStatusRejected": "Rejected",
  "providerSettlements.historyStatusCancelled": "Cancelled / Released",
  "providerSettlements.historyTableWithdrawalId": "Withdrawal ID",
  "providerSettlements.historyTableAmount": "Amount",
  "providerSettlements.historyTableStatus": "Status",
  "providerSettlements.historyTableReason": "Reason",
  "providerSettlements.historyTableNonce": "Nonce",
  "providerSettlements.historyTableCreated": "Created",
  "providerSettlements.historyTableTxHash": "Tx Hash",
  "providerSettlements.historyEmpty": "No withdrawal records yet.",
  "providerSettlements.historyFilteredEmpty":
    "No records match the current filter.",
  "providerSettlements.searchButton": "Search",
  "providerSettlements.loadingHistory": "Loading...",
  "providerSettlements.viewInvocationRecords": "View Invocation Records",
  "providerSettlements.loadHistoryFailed": "Failed to load withdrawal history",
  "providerSettlements.vaultAddressMissing": "Vault address missing",
  "providerSettlements.ticketSigningUnavailable": "Signer unavailable",
  "providerSettlements.vaultLiquidityCheckUnavailable":
    "Vault liquidity check unavailable",
  "providerSettlements.chainRpcUnavailable":
    "The withdrawal network is temporarily unavailable. Please retry in a moment.",
  "providerSettlements.providerReceivableNotMatured":
    "Provider earnings are still in the T+7 maturity window. Only matured receivables can be withdrawn; newly earned receivables still appear in balance.",
  "providerSettlements.minWithdrawalAmountNotMet":
    "Minimum provider withdrawal amount is 10.00 USDC.",
  "providerSettlements.insufficientProviderReceivable":
    "Withdrawable provider receivable is insufficient.",
  "providerSettlements.pendingWithdrawalExists":
    "A provider withdrawal is already pending.",
  "providerSettlements.withdrawalCreateFailed": "Failed to create withdrawal",
  "providerSettlements.noPendingTicket": "No pending withdrawal found",
  "providerSettlements.chainRequiredNetwork": "required network",
  "providerSettlements.vaultLiquidityInsufficient":
    "Vault liquidity insufficient",
  "providerSettlements.walletClientUnavailable": "Wallet client unavailable",
  "providerSettlements.connectWalletFirst": "Connect wallet first",
  "providerSettlements.withdrawalContractMissing": "Contract missing",
  "providerSettlements.walletRejected": "Wallet rejected",
  "providerSettlements.insufficientNativeGas": "Insufficient native gas",
  "providerSettlements.ticketExpired":
    "This withdrawal approval has expired. Create a new withdrawal request before retrying.",
  "providerSettlements.ticketExpiringSoon":
    "This withdrawal approval expires soon. Wait a moment, then create a new withdrawal request to avoid a failed transaction.",
  "providerSettlements.staleTicket":
    "This withdrawal approval is no longer valid. Create a new withdrawal request before retrying.",
  "providerSettlements.invalidSignature": "Invalid signature",
  "providerSettlements.confirmWithdraw": "Confirm",
  "providerSettlements.withdrawAmountPlaceholder": "Amount",
  "providerSettlements.pendingReviewExists":
    "A withdrawal is already pending review.",
  "providerSettlements.generatingTicket": "Preparing withdrawal...",
  "providerSettlements.settledCompleted": "Withdrawal settled",
  "providerSettlements.backendCompletionFailed":
    "Withdrawal was submitted. Your records are syncing; contact support if the status does not update soon.",
  "providerSettlements.pendingTicketExpiredBanner":
    "The pending withdrawal expired. Create a new withdrawal request before retrying.",
  "providerSettlements.pendingTicketExpiredReleased":
    "Expired withdrawal released.",
  "providerSettlements.expiredTicketReleasedRow":
    "Expired withdrawal released.",
  "providerSettlements.nativeTokenFallback": "native token",
  "providerSettlements.txSubmitted": "Tx submitted",
  "providerSettlements.ticketGenerated": "Withdrawal is ready",
  "providerSettlements.manualReviewQueued": "Queued for review",
  "providerSettlements.withdrawalIntentCreated": "Withdrawal request created",
  "providerSettlements.invalidAmountPrecision": "Invalid precision",
  "providerSettlements.invalidAmountValue": "Invalid amount",
  "providerSettlements.amountBelowMinimum":
    "Minimum withdrawal amount is {{amount}} USDC.",
  "providerSettlements.withdrawAmountHint":
    "Minimum withdrawal: {{amount}} USDC",
};

export const ZH_TRANSLATIONS: Record<string, string> = {
  ...TRANSLATIONS,
  "providerSettlements.withdrawPageTitle": "Provider \u63d0\u73b0",
  "providerSettlements.withdrawPageDescription":
    "EIP-712 \u94fe\u4e0a\u81ea\u52a9\u63d0\u73b0。",
  "providerSettlements.metricAvailable": "\u53ef\u7528\u4f59\u989d",
  "providerSettlements.withdrawableReceivable":
    "\u53ef\u63d0\u73b0\u989d\u5ea6",
  "providerSettlements.receivableBalance": "\u5e94\u6536\u4f59\u989d",
  "providerSettlements.immatureReceivableNotice":
    "\u65b0\u4ea7\u751f\u7684\u5e94\u6536\u4f1a\u5148\u663e\u793a\u5728\u4f59\u989d\u4e2d，T+7 \u540e\u624d\u8fdb\u5165\u53ef\u63d0\u73b0\u989d\u5ea6。",
  "providerSettlements.matureReceivableBelowMinimumTitle":
    "\u5df2\u6210\u719f\u53ef\u63d0\u73b0\u989d\u5ea6\u4f4e\u4e8e\u6700\u5c0f\u63d0\u73b0\u91d1\u989d 10.00 USDC",
  "providerSettlements.generateAndClaim": "\u751f\u6210\u5e76\u63d0\u73b0",
  "providerSettlements.confirmWithdraw": "\u786e\u8ba4\u63d0\u73b0",
  "providerSettlements.withdrawAmountPlaceholder": "\u91d1\u989d",
  "providerSettlements.withdrawGasNote":
    "\u94fe\u4e0a\u4ea4\u6613 — \u9700\u8981\u652f\u4ed8\u5c11\u91cf\u539f\u751f\u4ee3\u5e01（\u5982 ETH）\u4f5c\u4e3a Gas \u8d39。",
  "providerSettlements.historyTitle": "\u63d0\u73b0\u5386\u53f2",
  "providerSettlements.historyFilterAll": "\u5168\u90e8",
  "providerSettlements.searchButton": "\u641c\u7d22",
  "providerSettlements.viewInvocationRecords":
    "\u67e5\u770b\u8c03\u7528\u8bb0\u5f55",
  "providerSettlements.historyEmpty":
    "\u6682\u65f6\u8fd8\u6ca1\u6709\u63d0\u73b0\u8bb0\u5f55。",
  "providerSettlements.providerReceivableNotMatured":
    "\u5f53\u524d\u6536\u76ca\u5c1a\u672a\u8fbe\u5230 T+7 \u6210\u719f\u671f。\u53ea\u6709\u5df2\u6210\u719f\u5e94\u6536\u53ef\u4ee5\u63d0\u73b0；\u65b0\u4ea7\u751f\u7684\u5e94\u6536\u4ecd\u4f1a\u663e\u793a\u5728\u4f59\u989d\u4e2d。",
  "providerSettlements.minWithdrawalAmountNotMet":
    "Provider \u6700\u5c0f\u63d0\u73b0\u91d1\u989d\u4e3a 10.00 USDC。",
  "providerSettlements.insufficientProviderReceivable":
    "\u53ef\u63d0\u73b0 Provider \u5e94\u6536\u4f59\u989d\u4e0d\u8db3。",
  "providerSettlements.pendingWithdrawalExists":
    "\u5df2\u7ecf\u5b58\u5728\u4e00\u7b14\u5f85\u5904\u7406 Provider \u63d0\u73b0。",
};
