import type { I18nMessages } from "@/i18n/schema";

const agentsPage: I18nMessages["agentsPage"] = {
  loadCredentialsFailed: "Failed to load agent credentials. Please try again.",
  loadDiscoveryFailed:
    "Failed to load discovery examples. The sandbox stays available after the gateway comes back.",
  connectWalletBeforeCreate:
    "Please connect your wallet before creating an agent.",
  walletUnavailable:
    "Wallet address unavailable. Please reconnect your wallet and try again.",
  signInBeforeCreate:
    "Please sign in with your wallet before creating an agent.",
  unnamedAgent: "Unnamed Agent",
  agentCreatedToast: "Agent created for owner {{owner}}",
  createAgentFailed:
    "Failed to create agent. Please check your balance and try again.",
  confirmRevoke:
    "Are you sure you want to revoke this agent's access? This action cannot be undone.",
  revokeFailed: "Failed to revoke credential.",
  agentLimitsUpdated: "Agent limits updated",
  updateAgentLimitsFailed: "Failed to update agent limits",
  signInBeforeContinuing: "Please sign in with your wallet before continuing.",
  credentialSavedToast: "Saved credential for {{service}}.",
  selectServiceBeforeInvoking: "Select a service before invoking the sandbox.",
  pasteCredentialBeforeRun:
    "Paste the full agent credential token before running the paid example.",
  payloadMustBeValidJson: "Payload must be valid JSON.",
  selectedServiceMissingProvider:
    "Selected service is missing a provider address.",
  paidInvocationCompleted: "Paid invocation completed.",
  invocationFailed: "Invocation failed",
  refreshWorkspace: "Refresh Workspace",
  connectWallet: "Connect Wallet",
  signIn: "Sign In",
  addFunds: "Add Funds",
  createAgent: "Create Agent",
  runFirstPaidInvocation: "Run First Paid Invocation",
  createAgentProfile: "Create Agent Profile",
  agentNameLabel: "Agent Name",
  agentNamePlaceholder: "e.g. ResearchBot-01",
  boundOwnerLabel: "Bound Owner",
  walletSessionRequired: "Wallet session required",
  dailyBudgetLabel: "Daily Budget (USDC)",
  maxCallsLabel: "Max Calls",
  createAgentHint:
    "Creating an agent will issue a unique credential bound to the active owner wallet session. You can revoke access or update budget policies at any time.",
  creating: "Creating...",
  issueCredential: "Issue Credential",
  credentialIssuedTitle: "Agent Credential Issued",
  credentialIssuedDescription:
    "Copy this token now. For security, it will not be shown again.",
  boundOwnerValueLabel: "Bound Owner",
  savedTokenCta: "I've Saved the Token",
  editAgentLimitsTitle: "Edit Agent Limits",
  editAgentLimitsDescription:
    "This edit flow updates runtime limits on the live credential. Budget amount and owner binding remain fixed at issuance for now.",
  rateLimitLabel: "Rate Limit (RPM)",
  expirationLabel: "Expiration",
  cancel: "Cancel",
  save: "Save",
  activationStatusAria: "Activation status strip",
  activationStatusEyebrow: "Activation Status",
  activationStatusTitle: "Owner readiness for the first paid agent call",
  activationStatusDescription:
    "Synapse is only activated when an issued credential completes a paid invocation. This strip shows the current blocker and the next action.",
  walletMetricTitle: "Wallet",
  connected: "Connected",
  disconnected: "Disconnected",
  sessionMetricTitle: "Session",
  authenticated: "Authenticated",
  missing: "Missing",
  ownerVaultBalanceMetricTitle: "Owner Vault Balance",
  ownerVaultBalanceTooltip:
    "Your available owner credit in the Synapse Vault for agent operations",
  activeAgentsMetricTitle: "Active Agents",
  lastInvocationMetricTitle: "Last Invocation",
  noSuccessfulInvocationYet: "No successful invocation yet",
  activationStatusHelpAria: "Help: {{title}}",
  activationRunwayAria: "Activation runway",
  activationRunwayEyebrow: "Activation Runway",
  activationRunwayTitle: "From funded owner to first paid agent call",
  activationRunwayDescription:
    "The runtime is only truly ready after a credential-backed invocation succeeds. These four stages make the blocker explicit and keep the next action local.",
  firstPaidInvocationCompleted: "First paid invocation completed",
  runwayConnectWalletHint: "Connect your wallet to begin.",
  runwaySignInHint: "Sign in with your wallet to authenticate.",
  runwayCurrentBalanceHint:
    "Current balance: {{balance}} USDC. Ready to create agents.",
  runwayWalletBalanceHint:
    "Wallet balance: {{balance}} USDC. Transfer to vault to fund agents.",
  runwayFundOwnerVaultTitle: "Fund Owner Vault",
  runwayDepositUsdc: "Deposit USDC",
  runwayDepositTooltip:
    "Move USDC from your wallet into the Synapse Vault so your runtime has spendable credit for paid agent calls.",
  runwayCreateAgentRuntimeTitle: "Create Agent Runtime",
  runwayAgentCreated: "Agent created",
  runwayNoActiveAgent: "No active agent yet",
  runwayFundingReady: "Funding is ready. Create your first agent runtime.",
  runwayFundVaultFirst: "Fund the vault first to create an agent.",
  runwayCreateAgentAction: "Create Agent",
  runwayAgentTooltip:
    "Create the runtime identity that owns budget, call limits, and service discovery for your autonomous agent.",
  runwayCaptureCredentialTitle: "Capture Credential",
  runwayCredentialSummary: "Token: {{prefix}}...",
  runwayNoCredentialVisible: "No credential visible yet",
  runwayCopySaveToken: "Copy and save the token in your application code.",
  runwayCreateAgentFirst: "Create an agent first to generate a credential.",
  runwayCopyCredential: "Copy Credential",
  runwayCredentialTooltip:
    "Generate the one-time runtime credential your agent uses to authenticate paid calls. Copy it once and store it securely.",
  runwayRunInvocationTitle: "Run First Paid Invocation",
  runwayInvocationCompleted: "First invocation completed",
  runwayScrollSandbox:
    "Scroll down to the sandbox and run an example invocation.",
  runwayCompletePreviousSteps: "Complete the previous steps first.",
  runwayRunExample: "Run Example",
  runwayInvokeTooltip:
    "Use the credential to discover a service, settle payment, and prove the runtime can complete its first autonomous paid call.",
  depositConfirmedToast:
    "Deposit confirmed. You can create the first runtime now.",
  credentialCopiedToast: "Credential copied to clipboard.",
  signInToDepositFunds: "Please sign in to deposit funds.",
  currentSummaryLabel: "Current Summary",
  copied: "Copied",
  depositModalTitle: "Fund Owner Vault",
  depositModalDescription:
    "Transfer USDC from your wallet into the Synapse Vault. This becomes your credit balance for agent operations.",
  firstInvocationAria: "First invocation panel",
  firstInvocationEyebrow: "First Invocation",
  firstInvocationTitle: "Discovery, quote, and invoke in one place",
  firstInvocationDescription:
    "This panel turns the agent credential into a real call path. Pick a service, inspect the SDK snippets, then run the same payload through the paid sandbox below.",
  demoServiceLabel: "Demo Service",
  noPublicServicesAvailable: "No public services available",
  discoveryResultLabel: "Discovery Result",
  noServiceSelected: "No service selected",
  discoverPublicServiceHint:
    "Discover a public service before quoting and invoking.",
  quotePreviewLabel: "Quote Preview",
  unknown: "Unknown",
  quotePreviewDescription:
    "Current catalog pricing. The SDK quote step finalizes the payment terms before invoke.",
  gatewayEndpointLabel: "Gateway Endpoint",
  noEndpointSelected: "No endpoint selected",
  browseMarketplace: "Browse Marketplace",
  sdkGuide: "SDK Guide",
  copy: "Copy",
  sandboxInvocationEyebrow: "Sandbox Invocation",
  sandboxInvocationTitle: "Run the paid example with a real credential",
  sandboxInvocationDescription:
    "Paste the one-time credential, persist it for this service, then execute the payload. The result shows the on-chain payment hash and the gateway response together.",
  agentCredentialLabel: "Agent Credential",
  agentCredentialPlaceholder: "Paste the one-time credential token here",
  saveForService: "Save For Service",
  copyPayload: "Copy Payload",
  invokePayloadLabel: "Invoke Payload",
  processingPaymentAndInvoke: "Processing Payment And Invoke",
  runPaidExample: "Run Paid Example",
  resultLabel: "Result",
  resultServiceLabel: "Service",
  resultChargedLabel: "Charged",
  resultAttemptsLabel: "Attempts",
  resultLatencyLabel: "Latency",
  resultTransactionHashLabel: "Transaction Hash",
  resultRequestIdLabel: "Request Id",
  unavailableInGatewayResponse: "Unavailable in gateway response",
  noInvocationYet:
    "No invocation has been executed from this panel yet. A successful run will display the payment hash, retry count, charged USDC, request id, and gateway payload here.",
  workspaceNoMatchingAgents: "No matching agents",
  workspaceNoMatchingAgentsDescription:
    "Issue a new agent credential to populate this workspace.",
  workspaceCreateAgentCta: "Create Agent",
  workspaceTableAgent: "Agent",
  workspaceTableBudget: "Budget",
  workspaceTableUsage: "Usage",
  workspaceTableRateLimit: "Rate Limit",
  workspaceTableStatus: "Status",
  workspaceTableUpdated: "Updated",
  workspaceTableActions: "Actions",
  workspaceBudgetIssuedHint: "Owner-bound budget set at issuance.",
  workspaceUsageCapHint: "{{percent}}% of the current cap",
  workspaceUnlimited: "Unlimited",
  workspaceRateLimitHint: "Call cap and expiry can be adjusted from Edit.",
  workspacePending: "Pending",
  workspaceEdit: "Edit",
  workspaceRevokeTitle: "Revoke agent",
  workspaceSummaryTotalAgents: "Total Agents",
  workspaceSummaryActiveAgents:
    "{{count}} runtime profiles are currently active.",
  workspaceSummaryBudgetEnvelope: "Budget Envelope",
  workspaceSummaryBudgetEnvelopeDescription:
    "Issued runtime budget across the current owner workspace.",
  workspaceSummaryNeedsAttention: "Needs Attention",
  workspaceSummaryNeedsAttentionDescription:
    "Agents nearing quota or expiry should be adjusted before jobs stall.",
  workspaceSummaryRemainingCalls: "Remaining Calls",
  workspaceSummaryRemainingCallsDescription:
    "Available call headroom left inside the currently issued credentials.",
  workspaceTitle: "Agent Workspace",
  workspaceDescription:
    "This page is the standalone workspace for agent runtime identities. Keep cards for quick posture, but use the registry list as the primary operating surface for edits, quota reviews, and revocation.",
  workspaceCreateNewAgent: "Create New Agent",
  workspaceHighlightsEyebrow: "Workspace Highlights",
  workspaceHighlightsTitle: "Cards stay for quick posture",
  workspaceHighlightsDescription:
    "Use them to spot who needs attention first. The actual management workflow lives in the registry list on the right.",
  workspaceToneRevoked: "Revoked",
  workspaceToneReview: "Review",
  workspaceToneHealthy: "Healthy",
  workspaceRegistryEyebrow: "Workspace Registry",
  workspaceRegistryTitle: "List view is the main control surface",
  workspaceRegistryDescription:
    "Cards are useful for posture. Registry rows are better for owner-scale work because they keep status, budget, usage, and actions on one line.",
  workspaceYourAgentsTitle: "Your Agents",
  workspaceYourAgentsDescription:
    "Manage runtime identities and rotate credentials from one compact workspace.",
  workspaceManageAgents: "Manage agents",
  workspaceDoneManaging: "Done",
  workspaceManaging: "Managing...",
  workspaceSimpleTitle: "Agents",
  workspaceSimpleDescription: "Manage agents and agents Credential",
  workspaceCreateAgentCompact: "Create Agent +",
  workspaceAgentLimitHint: "{{count}} / {{limit}} agents created",
  workspaceAgentLimitReached:
    "You can create up to {{limit}} agents. Delete one before creating another.",
  workspaceAgentCardDescription:
    "This agent was created to use the Synapse API.",
  workspaceDetailEmptyTitle: "View Agent Details",
  workspaceDetailEmptyDescription:
    "Click any agent from the left panel to inspect its runtime profile, limits, and credential controls.",
  workspaceDetailDescription:
    "Manage API keys, limits, and authentication credentials for this runtime.",
  workspaceCloseDetail: "Close agent detail",
  workspaceCopyAgentId: "Copy agent id",
  workspaceCredentialPanelTitle: "Agent Credential",
  workspaceCredentialPanelDescription:
    "Rotate the runtime secret when needed. The full token is only shown once after issue or regenerate.",
  workspaceCredentialPrefixLabel: "Credential Prefix",
  workspaceQuotaPanelTitle: "Runtime Limits",
  workspaceQuotaPanelDescription:
    "Inspect budget, usage, rate limit, and refresh the spending envelope for this runtime.",
  workspaceGenerateCredential: "Generate",
  workspaceGenerating: "Generating...",
  workspaceRegenerateCredential: "Regenerate Credential",
  workspaceRegenerateShort: "Regenerate",
  workspaceRegenerating: "Regenerating...",
  workspaceRevokeShort: "Revoke",
  workspaceDangerGenerateTitle: "Generate Agent Credential",
  workspaceDangerGenerateQuestion:
    "Generate a new credential for this runtime?",
  workspaceDangerGenerateDescription:
    "Synapse will issue a new runtime secret for this agent. The full token will only be shown once after generation.",
  workspaceDangerRegenerateTitle: "Regenerate Agent Credential",
  workspaceDangerRegenerateQuestion:
    "Are you sure you want to regenerate this credential?",
  workspaceDangerRegenerateDescription:
    "If you regenerate this credential, you will need to update your agent runtime with the new secret. The current credential will stop authenticating once rotation completes.",
  workspaceDangerRevokeTitle: "Revoke Agent Credential",
  workspaceDangerRevokeQuestion:
    "Are you sure you want to revoke this credential?",
  workspaceDangerRevokeDescription:
    "If you revoke this credential, the current runtime will stop authenticating paid calls until a new credential is issued.",
  workspaceDangerConfirmGenerate: "Generate",
  workspaceDangerConfirmRegenerate: "Yes, regenerate",
  workspaceDangerConfirmRevoke: "Yes, revoke",
  workspaceCredentialGeneratedToast: "Agent credential generated.",
  workspaceCredentialGeneratedFailed: "Failed to generate agent credential.",
  workspaceCredentialRegeneratedToast: "Agent credential regenerated.",
  workspaceCredentialRegeneratedFailed:
    "Failed to regenerate agent credential.",
  workspaceDeleteAgentLabel: "Delete agent",
  workspaceDeleteAgentTitle: "Confirm Deletion",
  workspaceDeleteAgentDescription:
    "Are you sure you want to delete {{name}}? This action permanently removes the runtime profile and credential from this workspace.",
  workspaceDeleteAgentConfirmInstruction: "Please type {{name}} to confirm:",
  workspaceDeleteAgentPlaceholder: "Type {{name}} to confirm",
  workspaceDeleteAgentConfirm: "Delete",
  workspaceDeleteAgentTypingMismatch:
    "Type the exact agent name to enable deletion.",
  workspaceDeleteAgentDeletedToast: "Agent deleted.",
  workspaceDeleteAgentDeletedFailed: "Failed to delete agent.",
  workspaceBudgetTile: "Budget",
  workspaceUsageTile: "Usage",
  workspaceRateLimitTile: "Rate Limit",
  workspaceRemainingCallsTile: "Remaining Calls",
  workspaceUsageBarLabel: "Current call cap usage",
  workspaceDetailMetaTitle: "Runtime Metadata",
  workspaceStatusTile: "Status",
  workspaceUpdatedTile: "Updated",
  workspaceSecretVisibilityTitle: "Secret visibility",
  workspaceSecretVisibilityDescription:
    "Synapse only reveals the full credential at issue time. Regenerate when you need a new secret for the same runtime posture.",
  workspaceFilterActive: "Active only",
  workspaceFilterRevoked: "Revoked only",
  workspaceHighlightRevokedDetail:
    "This agent has been revoked and no longer authenticates runtime calls.",
  workspaceHighlightAttentionDetail:
    "Usage is at {{percent}}% of the current call cap. Review limits before automation stalls.",
  workspaceHighlightHealthyDetail:
    "Healthy runtime profile with {{remaining}} calls left in the current quota window.",
  workspaceRailEyebrow: "Workspace Activation",
  workspaceRailTitle: "Fund, allocate, credential, and run",
  workspaceRailDescription:
    "Agent Workspace should teach the operating sequence, not just list identities. Use this rail to see what is blocking the next paid runtime action.",
  workspaceRailOpenTreasury: "Open Treasury",
  workspaceRailOpenCredits: "Open Credits",
  workspaceRailCreateAgent: "Create Agent",
  workspaceRailOpenGuide: "Open Guide",
  workspaceRailReviewRegistry: "Review Registry",
  workspaceRailStepFundTitle: "Fund Treasury",
  workspaceRailStepFundSummaryReady: "Treasury has spendable USDC.",
  workspaceRailStepFundSummaryEmpty: "No treasury balance yet.",
  workspaceRailStepCreateTitle: "Create Agent",
  workspaceRailStepCreateSummaryReady: "At least one active runtime exists.",
  workspaceRailStepCreateSummaryEmpty: "No active agent runtime yet.",
  workspaceRailStepAllocateTitle: "Allocate Credits",
  workspaceRailStepAllocateSummaryReady: "Agent budgets have been assigned.",
  workspaceRailStepAllocateSummaryEmpty: "Credits still need allocation.",
  workspaceRailStepCredentialTitle: "Credential Ready",
  workspaceRailStepCredentialSummaryReady:
    "At least one runtime credential is live.",
  workspaceRailStepCredentialSummaryEmpty: "No credential visible yet.",
  workspaceRailStepInvokeTitle: "Run Invocation",
  workspaceRailStepInvokeSummaryReady:
    "A successful paid invocation already exists.",
  workspaceRailStepInvokeSummaryEmpty: "No successful invocation yet.",
  workspaceRailStateDone: "Done",
  workspaceRailStateReady: "Ready",
  workspaceRailStateLocked: "Locked",
  workspaceRailStateBlocked: "Blocked",
  workspaceRailStatePanelDoneTitle: "Workspace is live",
  workspaceRailStatePanelDoneDescription:
    "Treasury, credits, credential, and runtime invocation are all active. Use Credits to rebalance budgets or open the guide to run another demo call.",
  workspaceRailStatePanelDepositTitle: "Deposit treasury funds first",
  workspaceRailStatePanelDepositDescription:
    "Without owner treasury balance, no agent can spend. Start in Treasury, then return here to create the first runtime.",
  workspaceRailStatePanelCreateTitle: "Create the first runtime identity",
  workspaceRailStatePanelCreateDescription:
    "The owner has funds, but no agent exists yet. Create an agent so Synapse can issue runtime budget and credentials.",
  workspaceRailStatePanelAllocateTitle: "Allocate credits before spending",
  workspaceRailStatePanelAllocateDescription:
    "The agent exists, but runtime budget has not been assigned. Open Credits to allocate spendable budget before the first invocation.",
  workspaceRailStatePanelInvokeTitle: "Run the first paid invocation",
  workspaceRailStatePanelInvokeDescription:
    "The runtime is funded and credentialed. Open the guide to prove the first paid call end-to-end.",
};

export default agentsPage;
