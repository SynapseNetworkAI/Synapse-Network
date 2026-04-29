import type { I18nMessages } from "@/i18n/schema";

const aboutPage: I18nMessages["aboutPage"] = {
  eyebrow: "关于 SynapseNetwork",
  title: "AI Agent 经济的结算层。",
  description: "链上担保，链下用量，凭证清算。",
  primaryCta: "浏览 Marketplace",
  secondaryCta: "阅读文档",
  xCta: "关注 X",
  heroFeatureCards: [
    "每次 API 调用 0 gas|面向 Agent 的亚分级、高频支付。",
    "USDC 原生对账|加密凭证，默认可审计。",
    "Provider 无需自建计费系统|接入服务，获得收入，全球扩展。",
  ],
  agentRailLabel: "AI Agents",
  providerRailLabel: "服务与 Provider",
  collateralLabel: "USDC Collateral",
  collateralDescription: "链上担保",
  auditLabel: "可审计凭证",
  auditChecks: ["防篡改日志", "可验证用量", "确定性清算"],
  providerTypes: [
    "LLM Provider|模型推理",
    "Data Provider|实时 API",
    "Tool Provider|函数与工具",
  ],
  heroSignal: "Agent Commerce 正在进入机器速度。",
  heroSignalDetail: "支付系统也必须同样快速、可编程、可对账。",
  protocolLabel: "工作机制",
  protocolTitle: "链上担保，链下计费，凭证清算。",
  protocolDescription:
    "网络把昂贵的链上动作放在边界，把每一次 API 调用保留为可定价、可计量、可追踪的账务事件。",
  protocolSteps: [
    "Consumer 将 USDC 充值到 Vault。",
    "Agent 使用 Gateway 凭证调用 Provider 服务。",
    "Synapse 毫秒级计量、扣款，并给 Provider 记账。",
    "Provider 使用签名 Ticket 提现，最终在链上完成清算。",
  ],
  thesisLabel: "基础设施判断",
  thesisTitle: "AI 智能体需要一条为高频、小额、可验证工作而生的支付轨道。",
  thesisDescription:
    "信用卡和人工账单是给人类用的；纯智能合约又太慢、太贵，不适合每一次微调用。SynapseNetwork 把两边连接起来，让 builder 不必二选一。",
  thesisItems: [
    "Agent 每次 API 调用 0 gas",
    "USDC 原生余额与对账",
    "Provider 不必自建计费系统也能收款",
    "面向财务、安全和运维的审计链路",
  ],
  commitmentsLabel: "我们守住什么",
  commitmentsTitle: "网络从第一天就以资金安全为中心设计。",
  commitments: [
    "没有 ledger entry，就没有隐藏的余额变更。",
    "没有签名提现路径，就没有 Provider payout。",
    "没有 evidence、监控和回滚记录，就没有 production release。",
  ],
  proofLabel: "我们要走向哪里",
  proofTitle: "从 API Marketplace 到机器对机器经济。",
  proofPoints: [
    "API Provider 可以发布 Agent 可发现、可调用的服务。",
    "LLM Provider 可以接入按 token 计费的大模型接口。",
    "Operator 可以在一个控制面里对账充值、退款、提现和手续费。",
  ],
  finalTitle: "构建一个 Agent 可以彼此付费的网络。",
  finalDescription:
    "SynapseNetwork 是自治软件购买工作、赚取收入、证明发生过什么所需的支付与结算底座。",
  missionLabel: "我们的使命",
  missionBody:
    "成为 AI Agent 的全球结算层，让机器可以自由、安全、规模化地进行交易。",
  values: [
    "信任优先|用密码学替代口头约定。",
    "性能优先|为实时、机器规模的调用而构建。",
    "开放可组合|为生态提供可互操作的支付轨道。",
    "激励一致|费用公平，清算透明。",
  ],
};

export default aboutPage;
