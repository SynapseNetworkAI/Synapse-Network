import type { I18nMessages } from "@/i18n/schema";

const walletActions: I18nMessages["walletActions"] = {
  loginTitle: "Sign in to SynapseNetwork",
  loginDescription:
    "Review the request before opening your wallet. This signature only proves wallet ownership.",
  loginPurposeLabel: "Purpose",
  loginPurposeValue: "Create a Synapse dashboard session",
  loginDomainLabel: "Domain",
  loginWalletLabel: "Wallet",
  loginNetworkLabel: "Network",
  loginNoFundsLabel: "Funds",
  loginNoFundsValue: "No transaction. No funds move.",
  loginChecklistTitle: "Wallet checklist",
  loginChecklistDomain:
    "The wallet domain should match the Synapse page you opened.",
  loginChecklistNoFunds:
    "The message must say it does not authorize a transaction or move funds.",
  loginChecklistNonce: "A fresh nonce is requested every time you retry.",
  continueToWallet: "Continue to wallet",
  cancel: "Cancel",
  close: "Close wallet request",
  requestCancelled: "Request cancelled.",
  sessionExpiredRetry:
    "Wallet session expired or the challenge was already used. Please try again.",
  walletReconnecting: "Wallet reconnecting. Please wait a moment.",
  walletConnectorNotReady:
    "Wallet is not fully connected yet. Please reconnect and retry.",
  walletSingleAccount:
    "Please select only one account in your wallet, then reconnect.",
  walletUnstable:
    "Wallet connection is unstable. Please reconnect wallet and retry.",
  walletUnsupportedForArbitrum:
    "Phantom currently does not support Arbitrum. Please use MetaMask or Rabby for Synapse on Arbitrum.",
  connectWalletArbitrumHint:
    "Recommended for Arbitrum: MetaMask or Rabby. Phantom supports some EVM chains, but not Arbitrum.",
  authGatewayUnavailable:
    "Unable to reach the wallet auth gateway. Please refresh and try again.",
  walletWrongNetwork:
    "Wallet network does not match Synapse Arbitrum. Please switch wallet network and try again.",
  authFailedPrefix: "Auth failed: {{message}}",
  depositChecklistTitle: "Wallet checklist",
  depositChecklistNetwork: "Network matches this Synapse environment.",
  depositChecklistWallet: "Connected wallet matches the source wallet.",
  depositChecklistVault: "Spender / vault contract matches Synapse Vault.",
  depositChecklistAmount: "Amount matches the USDC amount shown here.",
  depositChecklistGas:
    "Permit is gasless; the vault deposit transaction requires native gas.",
  depositPermitStepTitle: "Step 1: Permit authorization",
  depositVaultStepTitle: "Step 2: Vault deposit transaction",
  withdrawIntentTitle: "Review withdrawal intent",
  withdrawIntentDescription:
    "Review the withdrawal before opening your wallet. The on-chain claim requires native gas.",
  withdrawAmountLabel: "Amount",
  withdrawMaturedFundsLabel: "Matured funds",
  withdrawTicketLabel: "Approval",
  withdrawDeadlineLabel: "Deadline",
  withdrawVaultLabel: "Vault contract",
  withdrawGasLabel: "Gas",
  withdrawGasValue: "Native gas is required for the on-chain claim.",
  withdrawChecklistTitle: "Before confirming in wallet",
  withdrawChecklistMatured:
    "Only matured withdrawable funds can be claimed on-chain.",
  withdrawChecklistTicket:
    "Use the latest withdrawal approval; expired or reused approvals fail.",
  withdrawChecklistAmount: "Amount and fee must match the wallet prompt.",
};

export default walletActions;
