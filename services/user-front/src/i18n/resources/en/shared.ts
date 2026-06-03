import type { I18nMessages } from "@/i18n/schema";

const shared: Pick<
  I18nMessages,
  | "language"
  | "loadingScreen"
  | "copyable"
  | "nav"
  | "sidebar"
  | "accountSettingsPage"
> = {
  language: {
    en: "English",
    zh: "Chinese",
  },
  loadingScreen: {
    eyebrow: "Synapse Network",
    title: "Settlement Infrastructure for the Agentic Era.",
    status: "Loading...",
  },
  copyable: {
    copyValue: "Copy {{label}}",
    copiedValue: "{{label}} copied",
    copyFailed: "Copy failed. Please try again.",
  },
  nav: {
    apiMarketplace: "API Marketplace",
    blog: "Blog",
    about: "About",
    docs: "Docs",
    documentation: "Documentation",
    forum: "Forum",
    notifications: "Notifications",
    notificationSubtitle: "Wallet-scoped product inbox.",
    notificationsLoading: "Loading notifications...",
    notificationsEmpty: "No notifications yet.",
    notificationLoadFailed: "Failed to load notifications.",
    withdrawalNotificationTitle: "Withdrawal security review",
    withdrawalNotificationBody:
      "Your withdrawal is under security review. We will update the status when review is complete.",
    markAllRead: "Mark all read",
    openNotification: "Open",
    archiveNotification: "Archive notification",
    gatewayNode: "Gateway Node",
    online: "Online",
    offline: "Offline",
    checking: "Checking...",
    search: "Search",
    searchPlaceholder: "Search routes, billing, services, or docs",
    quickAccess: "Quick Access",
    quickAccessHint:
      "Jump to any workspace, billing view, or developer surface.",
    quickAccessEmpty: "No matching routes found.",
    quickAccessOverviewDescription:
      "View workspace status, treasury posture, and launch controls.",
    quickAccessAgentsDescription:
      "Create, fund, and activate runtime identities.",
    quickAccessDiscoveryDescription:
      "Inspect available services and route health.",
    quickAccessInvocationsDescription:
      "Review paid runtime traffic and request traces.",
    quickAccessCreditsDescription:
      "Top up owner balance, vouchers, and spending caps.",
    quickAccessPaymentsDescription:
      "Review billing records and account payment activity.",
    quickAccessAuditDescription:
      "Monitor alerts, policy enforcement, and audit logs.",
    quickAccessDeveloperDescription:
      "Open docs, runtime examples, and integration guides.",
    quickAccessAccountSettingsDescription:
      "Adjust account identity visibility, preferences, and session posture.",
    quickAccessAccountWithdrawDescription:
      "Withdraw matured credits back to your wallet.",
    quickAccessProviderConsoleDescription:
      "Manage provider workspace health and performance.",
    quickAccessProviderCredentialsDescription:
      "Issue provider secrets and signing material.",
    quickAccessServicesDescription: "Create, edit, and publish monetized APIs.",
    quickAccessLlmCapabilitiesDescription:
      "Review LLM model onboarding and production gates.",
    quickAccessUsageDescription:
      "Track request volume, latency, and provider earnings.",
    quickAccessSettlementsDescription:
      "Review payouts, balances, and settlement history.",
    quickAccessMarketplaceDescription: "Browse public agent-ready services.",
    quickAccessBlogDescription: "Read product and ecosystem updates.",
    quickAccessAboutDescription:
      "See the product vision and infrastructure thesis.",
    productTagline: "Settlement Infrastructure for the Agentic Era",
    disconnect: "Disconnect",
    disconnectWallet: "Disconnect Wallet",
    walletDisconnected: "Wallet disconnected",
  },
  sidebar: {
    ownerControl: "Owner Control",
    overview: "Overview",
    agents: "Agents",
    billing: "Billing",
    credits: "Credits",
    payments: "Payments",
    account: "Account",
    settings: "Settings",
    logout: "Logout",
    logoutConfirmTitle: "Log out?",
    logoutConfirmDescription:
      "This disconnects the current wallet session and clears the local sign-in state for this browser.",
    logoutConfirmCancel: "Cancel",
    logoutConfirmAction: "Logout",
    login: "Sign In",
    discovery: "Discovery",
    invocations: "Invocations",
    treasury: "Payments",
    riskAudit: "Risk & Audit",
    developerResources: "Developer Resources",
    providerRole: "Provider Role",
    providerConsole: "Provider Console",
    providerCredentials: "Provider Credentials",
    myServices: "My Services",
    llmCapabilities: "LLM Capabilities",
    usageAnalytics: "Usage Analytics",
    settlements: "Settlements",
    settlement: "Settlement",
    withdraw: "Withdraw",
    withdrawHistory: "Withdraw History",
    invocationRecords: "Invocation Records",
  },
  accountSettingsPage: {
    title: "Settings",
    description: "Manage account metadata linked to your wallet.",
    profileTitle: "Account name",
    profileDescription: "",
    identitySummaryTitle: "Current identity",
    connectedWallet: "Wallet",
    notConnected: "Wallet not connected",
    walletCardTitle: "Wallet",
    walletRowDescription: "Wallet used for signed account updates.",
    walletSessionMissing:
      "Reconnect the wallet to unlock signed profile updates.",
    nameLabel: "Account name",
    namePlaceholder: "Synapse operator",
    nameHelp: "",
    emailLabel: "Email",
    emailDescription: "",
    emailPlaceholder: "ops@yourcompany.com",
    emailHelp: "Optional.",
    emailVerified: "Linked to this wallet.",
    emailVerifiedBadge: "Verified",
    emailPending:
      "Verification pending for {{email}}. It will bind only after code verification.",
    emailChange: "Change email",
    emailChangeCancelEdit: "Cancel edit",
    emailPendingCancel: "Cancel email change",
    emailChangeCancelled: "Pending email change cancelled.",
    emailRemove: "Remove email",
    emailRemoveConfirm:
      "Remove this email from your Synapse account? You will stop receiving receipts, support replies, and budget alerts by email until a new address is verified.",
    emailRemoved: "Email removed from this wallet.",
    emailVerificationSent:
      "Verification code sent. Enter it to bind this email.",
    emailVerificationSuccess: "Email verified and linked.",
    emailVerificationOpen: "Enter verification code",
    emailVerificationTitle: "Verify email",
    emailVerificationDescription:
      "Enter the 6-digit code sent to {{email}}. This email will bind only after verification.",
    emailVerificationCodeLabel: "Email verification code",
    emailVerificationCodeInvalid: "Enter the 6-digit verification code.",
    emailVerificationFailed: "Failed to verify email.",
    emailVerificationClose: "Close email verification",
    emailVerificationSubmit: "Verify email",
    emailVerificationVerifying: "Verifying...",
    emailVerificationResend: "Resend code",
    emailVerificationResending: "Sending...",
    emailVerificationResent: "Verification code sent again.",
    emailVerificationResendFailed: "Failed to resend verification code.",
    emailVerificationSendsRemaining:
      "You have {{count}} verification emails left today.",
    emailVerificationDailyLimit:
      "Daily email verification limit reached. Please try again tomorrow.",
    emailVerificationLocked:
      "Too many incorrect codes. Request a new code to continue.",
    emailVerificationExpired: "Verification code expired. Request a new code.",
    invalidEmail: "Enter a valid email address.",
    notifyMarketingTitle: "Earning reports",
    notifyMarketingDescription: "Revenue summaries by email.",
    notifyAlertsTitle: "Budget alerts",
    notifyAlertsDescription: "Alerts for spend and risk events.",
    securityTitle: "Session Security",
    securityDescription:
      "JWT keeps the session warm. The live wallet still signs every profile mutation.",
    saveRowTitle: "Save",
    saveRowDescription: "",
    saveButton: "Save settings",
    saving: "Saving...",
    saveHint: "A wallet signature is required.",
    saveRequiresWallet: "Reconnect wallet to save.",
    saveSuccess: "Account settings updated.",
    saveFailed: "Failed to update account settings.",
    loadFailed: "Failed to load account settings.",
    authorizeFirst:
      "Wallet session missing. Please authorize with wallet first.",
    walletRequired: "Wallet session missing. Please reconnect and try again.",
    connectWalletToSave:
      "Reconnect the wallet to sign and save account settings.",
    walletReconnectRequired:
      "Wallet connection is unstable. Please reconnect and retry the save.",
    unset: "Unset",
    loading: "Loading account posture...",
  },
};

export default shared;
