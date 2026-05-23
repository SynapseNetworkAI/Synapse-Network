import type { I18nMessages } from "@/i18n/schema";

const developerPage: I18nMessages["developerPage"] = {
  title: "Developer Resources",
  description:
    "REST API, SDK quickstarts, and MCP integration references. Auth via wallet · Spend via Agent Credentials · Funds in Owner Treasury.",
  agentCredentials: "Agent Credentials",
  ownerTreasury: "Owner Treasury",
  fullDocumentation: "Full Documentation",
  quickstartGuide: "Quickstart Guide",
  quickstartTypeScript: "TypeScript",
  quickstartPython: "Python",
  quickstartCopyCode: "Copy quickstart code",
  quickstartCodeCopied: "Quickstart copied",
  sdkInstallationTitle: "SDK Installation",
  sdkInstallationDescription:
    "Install the Synapse SDK to handle discovery, quoting, and invocation in your agent code.",
  sdkInstallCommand: "npm install @synapse-network-ai/sdk@1.0.0",
  copyInstallCommand: "Copy install command",
  installCommandCopied: "Install command copied",
  mcpIntegrationTitle: "MCP Integration",
  mcpIntegrationDescription:
    "Connect Synapse to Model Context Protocol (MCP) servers for seamless tool use with LLMs.",
  viewMcpGuide: "View MCP Guide",
  documentationTitle: "Documentation",
  docSections: [
    "Authentication & Credentials",
    "Discovery Protocol",
    "Quote & Settlement",
    "Budget Policy Engine",
    "Error Handling Contract",
    "Webhook Integration",
  ],
  needHelpTitle: "Need Help?",
  needHelpDescription:
    "Join our developer community to get support and share your agentic projects.",
  joinDiscord: "Join Discord",
};

export default developerPage;
