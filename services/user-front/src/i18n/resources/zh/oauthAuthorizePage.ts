import type { I18nMessages } from "@/i18n/schema";

const oauthAuthorizePage: I18nMessages["oauthAuthorizePage"] = {
  eyebrow: "Synapse OAuth",
  title: "授权 ChatGPT Remote MCP",
  description:
    "为 ChatGPT 批准一个带作用域的连接器 token。Synapse 会在服务端把它映射到你选择的 Agent 凭据。",
  boundaryTitle: "凭据边界",
  boundaryDescription:
    "ChatGPT 只会收到 OAuth access token 和 refresh token，不会收到原始 agt_xxx Agent Key；使用费用仍通过绑定的 Synapse Agent 余额结算。",
  signIn: "使用钱包签名",
  selectCredential: "选择 Agent 凭据",
  createCredential: "创建 ChatGPT 专用凭据",
  credentialCreated: "ChatGPT MCP 凭据已创建",
  createFailed: "创建 ChatGPT MCP 凭据失败",
  loadFailed: "加载 Agent 凭据失败",
  unnamedCredential: "未命名 Agent 凭据",
  credentialLimits: "最多 {{maxCalls}} 次调用，{{rpm}} rpm，每日 {{creditLimit}} USDC",
  emptyCredentials: "暂无活跃 Agent 凭据。请先创建一个 ChatGPT 专用凭据再授权。",
  requestTitle: "授权请求",
  client: "客户端",
  resource: "MCP 资源",
  scopes: "作用域",
  invalidRequest: "这个 OAuth 请求缺少 redirect URI 或 PKCE S256 参数。",
  approve: "授权 ChatGPT",
  approveFailed: "OAuth 授权失败",
};

export default oauthAuthorizePage;
