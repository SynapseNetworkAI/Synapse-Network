export const oauthAuthorizeCopy = {
  eyebrow: "Synapse OAuth",
  title: "Authorize ChatGPT Remote MCP",
  description:
    "Approve a scoped connector token for ChatGPT. Synapse maps that token to your selected Agent Credential on the server side.",
  boundaryTitle: "Credential boundary",
  boundaryDescription:
    "ChatGPT receives an OAuth access token and refresh token. It never receives the raw agt_xxx Agent Key; usage is billed through the linked Synapse Agent balance.",
  signIn: "Sign with wallet",
  selectCredential: "Select Agent Credential",
  createCredential: "Create ChatGPT credential",
  credentialCreated: "ChatGPT MCP credential created",
  createFailed: "Failed to create ChatGPT MCP credential",
  loadFailed: "Failed to load Agent Credentials",
  unnamedCredential: "Unnamed Agent Credential",
  credentialLimits: "Max {{maxCalls}} calls, {{rpm}} rpm, {{creditLimit}} USDC/day",
  emptyCredentials:
    "No active Agent Credentials are available. Create a dedicated ChatGPT credential before approving.",
  requestTitle: "Authorization request",
  client: "Client",
  resource: "MCP resource",
  scopes: "Scopes",
  invalidRequest: "This OAuth request is missing redirect URI or PKCE S256 parameters.",
  approve: "Authorize ChatGPT",
  approveFailed: "OAuth authorization failed",
} as const;
