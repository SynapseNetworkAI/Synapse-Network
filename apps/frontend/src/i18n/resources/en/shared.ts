import type { I18nMessages } from "@/i18n/schema";

const shared: Pick<I18nMessages, "language" | "nav" | "sidebar"> = {
  language: {
    en: "English",
    zh: "Chinese",
  },
  nav: {
    apiMarketplace: "API Marketplace",
    blog: "Blog",
    about: "About",
    gatewayNode: "Gateway Node",
    online: "Online",
    offline: "Offline",
    checking: "Checking...",
    disconnect: "Disconnect",
    disconnectWallet: "Disconnect Wallet",
    walletDisconnected: "Wallet disconnected",
  },
  sidebar: {
    ownerControl: "Owner Control",
    overview: "Overview",
    agents: "Agents",
    agentsWorkspace: "Agents Workspace",
    discovery: "Discovery",
    invocations: "Invocations",
    treasury: "Treasury",
    riskAudit: "Risk & Audit",
    developerResources: "Developer Resources",
    providerRole: "Provider Role",
    providerConsole: "Provider Console",
    providerCredentials: "Provider Credentials",
    myServices: "My Services",
    usageAnalytics: "Usage Analytics",
    settlements: "Settlements",
  },
};

export default shared;