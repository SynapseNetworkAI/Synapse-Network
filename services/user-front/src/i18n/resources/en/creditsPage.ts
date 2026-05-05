import type { I18nMessages } from "@/i18n/schema";

const creditsPage: I18nMessages["creditsPage"] = {
  title: "Credits",
  description: "Manage your free and prepaid credits",
  remainingBalanceLabel: "Spendable credits:",
  spendableBalanceLabel: "Spendable credits",
  withdrawableBalanceLabel: "Withdrawable credits",
  withdrawableBalanceTooltip:
    "To protect the network and reduce AML risk, newly deposited funds must remain in Synapse for 7 days before withdrawal. Your credits remain available for API usage during this period.",
  pendingBalanceLabel: "Pending / syncing credits",
  pendingDepositBalanceLabel: "Pending deposit credits",
  pendingWithdrawalBalanceLabel: "Pending withdrawal credits",
  frozenBalanceLabel: "Frozen / review credits",
  pendingBalanceHint:
    "Gateway is indexing the on-chain deposit. If it stays pending, contact support with the txHash.",
  pendingDepositBalanceHint:
    "Gateway is indexing the on-chain deposit. If it stays pending, contact support with the txHash.",
  pendingWithdrawalBalanceHint:
    "Withdrawal funds are locked and waiting for the on-chain claim to complete. They will be removed from pending after completion.",
  frozenBalanceHint:
    "Funds are locked for an active withdrawal, manual review, or risk control.",
  purchaseCredits: "Purchase credits",
  walletUnavailable: "Wallet unavailable. Please reconnect and try again.",
  signInBeforePurchase: "Please sign in with wallet before purchasing credits.",
  depositModalTitle: "Purchase credits",
  depositModalDescription:
    "Deposit USDC into your Synapse vault to top up prepaid credits for API usage.",
  depositConfirmationNotice:
    "Blockchain confirmation is in progress. Credits usually appear within 1-2 minutes. You can keep this page open or refresh later.",
  depositAmountLabel: "Amount (USDC)",
  depositWalletUsdcLabel: "Wallet USDC",
  depositNativeGasLabel: "Native gas balance",
  depositNetworkLabel: "Network",
  depositTransactionSummary: "Transaction summary",
  depositFromWallet: "From wallet",
  depositToVault: "To vault contract",
  depositAmountSummary: "Deposit amount",
  depositPermitAllowance: "Permit allowance",
  depositExpectationTitle: "Before you confirm",
  depositExpectationPermit:
    "The permit signature is gasless and authorizes only this USDC amount.",
  depositExpectationGas:
    "The vault deposit is an on-chain transaction and requires native gas.",
  depositExpectationSync:
    "Spendable credits appear after Gateway indexes and confirms the deposit.",
  depositMinimumWithdrawNotice:
    "Credits withdrawals require a minimum balance of 10 USDC. Please fund based on your expected API usage.",
  depositPermitStepTitle: "Step 1: Permit authorization",
  depositPermitStepActive:
    "Wallet prompt: sign a gasless permit for the exact amount.",
  depositPermitStepDone: "Permit signature completed.",
  depositVaultStepTitle: "Step 2: Vault deposit transaction",
  depositVaultStepActive:
    "Wallet prompt: submit the on-chain vault deposit and pay gas.",
  depositVaultStepWaiting: "Waiting for permit authorization.",
  depositProgressAria: "Deposit progress",
  depositCancel: "Cancel",
  depositProcessing: "Processing...",
  depositConfirm: "Confirm Deposit",
  depositTransactionFailed: "Deposit transaction failed",
  depositCancelled: "Deposit was cancelled in wallet. No funds were charged.",
  depositGasInsufficient:
    "Deposit failed because the wallet does not have enough native token to pay gas.",
  depositUsdcInsufficient:
    "Deposit failed because the wallet does not have enough USDC for this transfer.",
  depositVaultRejectedWithError:
    "Deposit was rejected by the vault contract ({{errorName}}). No funds were credited to the platform.",
  depositVaultRejectedWithReason:
    "Deposit was rejected by the vault contract: {{reason}}. No funds were credited to the platform.",
  depositVaultRejectedCustomError:
    "Deposit was rejected by the vault contract with a custom on-chain error. No funds were credited to the platform.",
  depositVaultRejected:
    "Deposit failed on-chain because the vault contract rejected this transaction. No funds were credited to the platform.",
  depositNonceOutOfDate:
    "Deposit failed because the wallet transaction nonce is out of date. Please retry from the wallet.",
  depositWalletReconnect:
    "Wallet not fully connected yet. Please reconnect and retry.",
  depositWalletSingleAccount:
    "Please select only one wallet account, then reconnect.",
  depositWalletUnstable:
    "Wallet connection unstable. Please reconnect wallet and retry.",
  depositInvalidAmount: "Enter a valid USDC amount.",
  depositMinAmountNotMet: "Minimum deposit amount is {{amount}} USDC.",
  depositInsufficientWalletUsdc:
    "Insufficient wallet USDC. Need {{amount}} USDC, wallet has {{balance}} USDC.",
  depositNativeGasRequired:
    "Deposit requires native gas for the vault transaction. Keep at least {{minimum}} {{symbol}} in this wallet.",
  depositGatewayBalanceSynced: "Gateway balance synced.",
  depositGatewayStillSyncing:
    "Deposit confirmed on-chain. Gateway is still syncing the balance.",
  depositConfirmedSyncing:
    "Deposit confirmed on-chain. Syncing gateway balance...",
  depositConnectWalletFirst: "Please connect your wallet first.",
  depositCancelledToast: "Sign/transaction cancelled by user",
  depositInsufficientFundsRetry:
    "Wallet USDC or native gas is insufficient. Please check the balances and retry.",
  depositTopUpFailedPrefix: "Failed to top up: {{message}}",
  depositUnknownError: "Unknown error",
  depositCloseDialog: "Close deposit dialog",
  consumerWithdrawTitle: "Withdraw Balance",
  consumerWithdrawDescription:
    "Withdraw matured credits back to your wallet. Withdrawable: {{amount}} USDC",
  consumerWithdrawAmountLabel: "Amount (USDC)",
  consumerWithdrawReasonLabel: "Reason (optional)",
  consumerWithdrawReasonPlaceholder: "Why are you withdrawing?",
  consumerWithdrawManualReviewHint:
    "Amounts >= $500 require manual review (12-24 h).",
  consumerWithdrawFrequencyHint: "Max 3 withdrawals per 24 hours.",
  consumerWithdrawGasHint:
    "Your wallet will execute the on-chain transfer and pay gas.",
  consumerWithdrawInvalidAmount: "Enter a valid amount.",
  consumerWithdrawAmountExceeds:
    "Amount exceeds available balance (${{amount}}).",
  consumerWithdrawSubmitted: "Withdrawal of ${{amount}} USDC completed!",
  consumerWithdrawBackendSyncFailed:
    "On-chain transfer succeeded but backend update failed. The background processor will complete it automatically.",
  consumerWithdrawReleaseFailed: "Failed to release the pending withdrawal.",
  consumerWithdrawPendingExists:
    "A pending withdrawal already exists. Finish or wait for the current request.",
  consumerWithdrawResumingPending:
    "Resuming your pending withdrawal in the wallet.",
  consumerWithdrawUnderReview:
    "Withdrawal submitted and is under review. Reason: {{reason}}",
  consumerWithdrawTicketUnavailable:
    "Withdrawal ticket is unavailable. Please retry after the gateway signs a fresh ticket.",
  consumerWithdrawTicketExpiring:
    "Withdrawal credential is about to expire. To avoid failed gas spend, create a new withdrawal request after this one expires.",
  consumerWithdrawTxSubmitted:
    "Transaction submitted — waiting for confirmation...",
  consumerWithdrawTxRejected: "Transaction rejected by wallet.",
  consumerWithdrawTxFailed:
    "On-chain transaction failed. Your balance was restored.",
  consumerWithdrawRequesting: "Requesting...",
  consumerWithdrawConfirmWallet: "Confirm in Wallet...",
  consumerWithdrawConfirmingChain: "Confirming on-chain...",
  consumerWithdrawCompleting: "Completing...",
  consumerWithdrawProgressSigning:
    "Requesting withdrawal ticket from server...",
  consumerWithdrawProgressOnchain:
    "Please confirm the transaction in your wallet.",
  consumerWithdrawProgressConfirming:
    "Transaction submitted. Waiting for block confirmation...",
  consumerWithdrawProgressCompleting: "On-chain confirmed. Updating records...",
  consumerWithdrawMax: "Max",
  consumerWithdrawAction: "Withdraw",
  consumerWithdrawPendingTooltip:
    "A withdrawal of {{amount}} is pending. Only one active withdrawal is allowed.",
  consumerWithdrawMaturityWarning:
    "Recent deposits are available for API usage, but require T+7 before withdrawal.",
  consumerWithdrawMinimumRule: "Minimum withdrawal amount: {{amount}} USDC",
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
    "SynapseNetwork may give out free credits to developers to build with the API. Enter a voucher code to add free credits to your account.",
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
  redeemVoucherModalSuccess:
    "Voucher redeemed. {{amount}} was added to your balance.",
  supportTitle: "Need help with deposit or billing?",
  supportDescription:
    "If credits do not arrive, a refund is stuck, or billing looks wrong, contact the operator directly before retrying the same payment flow.",
  supportAction: "Contact Support",
};

export default creditsPage;
