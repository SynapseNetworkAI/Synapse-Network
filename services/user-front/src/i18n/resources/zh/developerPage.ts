import type { I18nMessages } from "@/i18n/schema";

const developerPage: I18nMessages["developerPage"] = {
  title: "开发者资源",
  description:
    "面向自主 Agent 工作流的 SDK 文档、快速开始和集成参考。资金归属 Owner Treasury，运行时密钥归属 Agent Credentials。",
  agentCredentials: "Agent 凭据",
  ownerTreasury: "Owner 资金金库",
  fullDocumentation: "完整文档",
  quickstartGuide: "快速开始",
  quickstartTypeScript: "TypeScript",
  quickstartPython: "Python",
  quickstartCopyCode: "复制快速开始代码",
  quickstartCodeCopied: "已复制快速开始代码",
  sdkInstallationTitle: "SDK 安装",
  sdkInstallationDescription:
    "安装 Synapse SDK，在你的 Agent 代码里完成发现、报价和调用。",
  sdkInstallCommand: "npm install @synapse-network-ai/sdk@1.0.0",
  copyInstallCommand: "复制安装命令",
  installCommandCopied: "已复制安装命令",
  mcpIntegrationTitle: "MCP 集成",
  mcpIntegrationDescription:
    "把 Synapse 接入 Model Context Protocol (MCP) 服务器，让 LLM 无缝使用工具。",
  viewMcpGuide: "查看 MCP 指南",
  documentationTitle: "文档",
  docSections: [
    "认证与凭据",
    "发现协议",
    "报价与结算",
    "预算策略引擎",
    "错误处理契约",
    "Webhook 集成",
  ],
  needHelpTitle: "需要帮助？",
  needHelpDescription: "加入开发者社区，获取支持并分享你的 Agent 项目。",
  joinDiscord: "加入 Discord",
};

export default developerPage;
