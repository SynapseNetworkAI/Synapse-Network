import type { I18nMessages } from "@/i18n/schema";

const providerConsolePage: I18nMessages["providerConsolePage"] = {
  missingSigningSecret: "发布服务前请先创建 Provider Signing Secret。",
  verifySigningSecretFailed:
    "无法校验 Provider Signing Secret，请打开 Provider Credentials 后重试。",
  title: "Provider 控制台",
  description:
    "定义 API 服务、发布服务定义、封装 SDK，并把零 Gas 计费结算到 Synapse Vault。",
  newService: "新建服务",
  refreshConsole: "刷新控制台",
  metricNetEarnings: "净收益",
  metricGrossEarnings: "总收益",
  metricTotalApiCalls: "API 调用总量",
  metricActiveServices: "活跃服务",
  claim: "提取",
  withdrawableConsistent: "可提现一致余额",
  beforeProtocolDeductions: "协议扣减前",
  deduplicatedSettledCalls: "去重后的已结算调用",
  online: "在线",
  offline: "离线",
  runtimeAvailability: "运行时可用性",
  settlementBreakdown: "结算拆解",
  protocolFee: "协议费",
  routingTax: "路由税",
  providerNetLifetime: "Provider 净收益（累计）",
  deploymentPipeline: "部署流水线（2 步）",
  providerCredentialsTitle: "Provider 凭据",
  providerCredentialsDescription:
    "签发 Provider Signing Secret，让 Synapse Gateway 能对路由请求签名，也让你的运行时验证入站调用。",
  connectTerminalToManageKeys: "先连接终端再管理密钥",
  manageProviderCredentials: "管理 Provider 凭据",
  publishApiServiceTitle: "发布 API 服务",
  publishApiServiceDescription:
    "把 API 服务定义发布到市场，并一步开启按量运行时路由。",
  createService: "创建服务",
  credentialsBannerText: "发布服务前请先创建 Provider 凭据，只需一分钟。",
  credentialsBannerAction: "创建凭据",
};

export default providerConsolePage;
