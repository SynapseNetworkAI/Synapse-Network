# Provider Service 冷启动免费 API 方案设计

关联执行排期见：[Provider Service 冷启动实施路线图（7/14/30 天）](./IMPLEMENTATION_ROADMAP.md)

首批 5 个样板服务的 Manifest / Schema / Demo 草案见：[Provider Service 首批 5 个服务契约草案](./SERVICE_DRAFTS.md)

Provider Console 表单字段映射与简化版 `synapse_providers` 数据库设计见：[Provider Console 字段映射与简化数据库设计](./PROVIDER_CONSOLE_FIELD_MAPPING.md)

## 1. 目标

Synapse 不是一个“先把支付修好，市场自然会有货”的平台。

兄弟，这种想法会直接把双边市场做成鬼城。

Marketplace 冷启动的第一原则很简单：

**先把货架摆满，再谈买家增长。**

当前阶段，Platform 必须亲自下场，先兼职当 3 到 5 个头部 Provider，做出一批：

1. Agent 一看就知道怎么用
2. 用户一看就知道值不值钱
3. 上游可用免费 API 或开源能力快速接起来
4. 后续可以自然升级为付费版 / SLA 版 / 高频版

本文档给出两层方案：

1. **首批必须落地的 5 个冷启动样板服务**
2. **平台可介入的 20 个免费 API / 免费能力包装方案**

目标不是做一个“API 目录表”，而是做一个真正能让 Agent 完成首次自主付费调用的赛博超市。

## 2. 选择标准

冷启动服务不能乱选，必须同时满足以下 6 条：

1. **需求高频**：Agent 或用户在日常工作流里会反复用到
2. **结果可验证**：输出不是纯玄学，最好有结构化字段和来源
3. **调用边界清晰**：适合标准化成 `discover -> quote -> invoke`
4. **上游免费可得**：可以先接 free/public/open-source 资源快速起量
5. **后续可升级**：未来能演进为付费版、增强版、企业版
6. **能体现 Synapse 价值**：不是普通 API 聚合，而是“统一结算 + Agent Runtime 可消费”

## 3. 哪些领域需求最大

按 Synapse 当前产品阶段，需求优先级建议如下。

| 优先级 | 领域 | 为什么需求大 | 典型调用方 |
| --- | --- | --- | --- |
| P0 | Web3 市场情报 | 加密场景天然需要实时监控、情绪判断、资金异动 | Trading Agent, Research Agent, Ops 用户 |
| P0 | 安全审计与代码风险 | 合约、仓库、依赖都需要自动预检 | Security Agent, Dev 用户 |
| P0 | 链上数据解释 | 原始链上数据太硬，Agent 需要语义化结果 | Analyst Agent, 钱包用户 |
| P1 | 开源情报与漏洞情报 | GitHub、OSV、依赖生态是高频需求 | Dev Agent, CI Agent |
| P1 | 研究检索与摘要 | 论文、协议、文档检索是 Agent 基础能力 | Research Agent, 投研用户 |
| P1 | 风险与合规情报 | 地址风险、域名风险、新闻异常都常见 | Compliance Agent, 风控用户 |
| P2 | 通用效率工具 | 汇率、日历、天气、时区等通用工具有量，但壁垒低 | Productivity Agent, General User |

结论很直接：

**Synapse 第一批货架，不应该先铺天气、笑话、翻译这种通用低价值 API。**

应该先铺：

1. Web3 情报
2. 安全审计
3. 链上解释
4. 开源安全
5. 研究检索

这样平台一打开，就有“我愿意付钱调用一次试试”的冲动。

## 4. 首批必须落地的 5 个样板服务

这 5 个服务最适合 Platform 自己先当 Provider 去挂。

### 4.1 API 1: Web3 实时情绪指数

- 建议定价：`$0.01 / 次`
- 核心价值：把零散的市场情绪、趋势、成交活跃度压成一个 Agent 可消费的结构化结果
- 当前运行时上游：`Alternative.me Fear & Greed` + `Binance public market data`
- 典型输入：`symbol`, `lookbackHours`, `chain`, `includeNarrative`
- 典型输出：
  - `sentimentScore`
  - `sentimentLabel`
  - `trendDirection`
  - `volatilitySignal`
  - `reasoningBullets`
- 为什么适合冷启动：
  - 用户一眼能懂
  - Demo 演示感极强
  - 输出天然适合 Agent 决策

### 4.2 API 2: 智能合约漏洞深度审计模型

- 建议定价：`$0.50 / 次`
- 核心价值：不是卖一份 raw scanner 报告，而是卖“结构化风险结论 + 修复建议”
- 免费能力源：`Slither` + `Mythril` + `solc` + `Etherscan/Blockscout verified source`
- 典型输入：`contractAddress` 或 `sourceCodeZip`
- 典型输出：
  - `riskScore`
  - `criticalFindings`
  - `attackSurfaceSummary`
  - `fixSuggestions`
  - `evidenceSnippets`
- 为什么适合冷启动：
  - 高客单价
  - 高感知价值
  - 非常符合 Agent 自动审计 / pre-deploy check 场景

### 4.3 API 3: 链上巨鲸资金异动监控

- 建议定价：`$0.10 / 次`
- 核心价值：用户不想看原始 transfer log，他们想看“谁在动、动了多少、可能意味着什么”
- 免费上游：`Etherscan` / `Blockscout` / 公共 RPC / `DexScreener`
- 典型输入：`token`, `chain`, `minUsdValue`, `windowMinutes`
- 典型输出：
  - `events`
  - `walletTags`
  - `netDirection`
  - `marketImpactGuess`
  - `watchlistMatches`
- 为什么适合冷启动：
  - 典型 Web3 高频需求
  - 可做订阅和告警升级
  - 适合 Agent 自动巡检

### 4.4 API 4: 协议基本面情报包

- 建议定价：`$0.03 / 次`
- 核心价值：把 token price、TVL、协议收入、稳定币暴露等信息压缩成一个“可投研、可比较”的结构化摘要
- 免费上游：`CoinGecko` + `DefiLlama`
- 典型输入：`protocol`, `token`, `chain`
- 典型输出：
  - `priceSummary`
  - `tvlSummary`
  - `revenueSignals`
  - `peerComparison`
  - `riskFlags`
- 为什么适合冷启动：
  - 需求广
  - 实现快
  - 可以和情绪指数、巨鲸监控形成组合购买

### 4.5 API 5: 开源仓库与依赖安全体检

- 建议定价：`$0.05 / 次`
- 核心价值：输入 GitHub repo 或依赖清单，输出安全、活跃度、漏洞暴露、维护质量的一页结论
- 免费上游：`GitHub REST API` + `OSV.dev` + `PyPI JSON API` + `npm Registry API`
- 典型输入：`repoUrl`, `packageList`, `ecosystem`
- 典型输出：
  - `repoHealthScore`
  - `vulnerabilityMatches`
  - `maintainerActivity`
  - `dependencyRiskSummary`
  - `upgradeAdvice`
- 为什么适合冷启动：
  - 非 Web3 用户也能立刻用起来
  - 让 Synapse 看起来不是单一 crypto 市场，而是 Agent 工作基础设施

## 5. 平台可介入的 20 个免费 API / 免费能力方案

以下 20 个方案都适合 Platform 先自己挂，等市场热起来后，再让第三方 Provider 进来竞争。

| # | 服务名 | 领域 | 免费上游 / 免费能力 | Synapse 封装方式 | 主要需求方 | 需求热度 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Web3 实时情绪指数 | Web3 市场情报 | Alternative.me, Binance Public API | 多源聚合后输出统一情绪分 | Trading Agent, 投研用户 | 极高 |
| 2 | 智能合约漏洞深度审计模型 | 安全审计 | Slither, Mythril, solc, Etherscan/Blockscout | 静态分析 + 风险总结 + 修复建议 | Security Agent, 开发者 | 极高 |
| 3 | 链上巨鲸资金异动监控 | 链上监控 | Etherscan, Blockscout, 公共 RPC, DexScreener | 大额转账聚合、标签、事件解释 | Trading Agent, 风控用户 | 极高 |
| 4 | 协议基本面情报包 | 投研情报 | CoinGecko, DefiLlama | 价格、TVL、收入、风险因子统一输出 | Research Agent, 分析师 | 极高 |
| 5 | Gas 费用与执行窗口建议 | 交易执行 | Etherscan Gas Oracle, 公共 RPC | 返回当前 gas、分位数和执行建议 | Wallet Agent, Bot 开发者 | 高 |
| 6 | 稳定币脱锚与储备监控 | 风险监控 | CoinGecko, DefiLlama Stablecoins | 输出脱锚状态、流通变化、异常提示 | Treasury Agent, 风控用户 | 高 |
| 7 | 合约源码/ABI 检索与函数解释 | 链上解释 | Etherscan, Blockscout, 4byte.directory | 合约接口语义化、函数说明、可调用示例 | Dev Agent, 钱包用户 | 高 |
| 8 | 交易解码与意图解释 | 链上解释 | Blockscout, 4byte.directory, 公共 RPC | 把 tx input / logs 解释成人话 | Analyst Agent, 钱包用户 | 高 |
| 9 | 地址画像与风险标签摘要 | 地址风控 | Blockscout, 公共标签库, 平台自建标签 | 给地址打标签并输出简报 | Compliance Agent, 风控用户 | 高 |
| 10 | 协议 TVL / 收入变化雷达 | 市场监控 | DefiLlama | 输出近 1d/7d/30d TVL 与收入变化 | Research Agent, 交易员 | 高 |
| 11 | 代币流动性与交易深度快照 | 交易情报 | DexScreener, CoinGecko | 输出池深度、价差、成交热度 | Trading Agent | 高 |
| 12 | GitHub 仓库安全体检 | 开源安全 | GitHub REST API, OSV.dev | repo 活跃度、漏洞、维护状态一页总结 | Dev Agent, 采购用户 | 高 |
| 13 | 开源依赖漏洞扫描 | 开源安全 | OSV.dev, PyPI, npm Registry | 输入依赖列表，输出漏洞和升级建议 | CI Agent, 开发团队 | 高 |
| 14 | NPM/PyPI 包可信度评估 | 供应链安全 | PyPI JSON API, npm Registry API, GitHub API | 输出下载、维护、漏洞、作者活跃度 | Dev Agent, 安全团队 | 中高 |
| 15 | OSS License 与合规摘要 | 合规 | GitHub API, ClearlyDefined, SPDX 数据 | 输出许可证风险和可商用判断 | Legal Agent, 开发团队 | 中高 |
| 16 | 论文检索与三段式摘要 | 研究检索 | arXiv API, OpenAlex, Crossref | 结构化输出论文结论、方法、局限 | Research Agent, 产品团队 | 高 |
| 17 | 技术主题新闻快照 | 新闻情报 | GDELT, Hacker News Algolia | 输出某主题最新讨论和来源摘要 | Research Agent, 增长团队 | 中高 |
| 18 | SEC / 监管动态监控 | 监管情报 | SEC EDGAR API, 官方 RSS | 输出公司/主题相关监管动态 | Compliance Agent, 投研用户 | 中 |
| 19 | 汇率与结算参考服务 | 通用工具 | ECB Exchange Rates, Frankfurter API | 提供法币换算和结算参考价 | Finance Agent, 商务用户 | 中 |
| 20 | 日历 / 节假日 / 时区归一化 | 通用工具 | Nager.Date, WorldTime API 类免费源 | 输出可执行时间窗口和区域日历信息 | Scheduling Agent, Ops 用户 | 中 |

## 6. 每类服务的实现策略

平台不要直接把第三方 API 原封不动透传给用户。那不叫 Marketplace，那叫代理商。

正确做法是：

### 6.1 做语义层，而不是做转发层

举例：

- 错误做法：把 `CoinGecko /coins/markets` 原样返回
- 正确做法：返回 `sentimentScore`, `marketTemperature`, `riskBullets`, `actionHint`

Agent 需要的是**决策对象**，不是文档对象。

### 6.2 做多源聚合，而不是绑定单一上游

比如 `Web3 实时情绪指数`：

1. 用 `Alternative.me` 提供情绪基线
2. 用 `Binance` 公共行情提供价格、交易热度和短周期波动
4. 最终由 Synapse 输出统一结构

这样做的价值：

1. 不容易被单一源故障拖死
2. 可以形成自己的结果层和品牌层
3. 后续切换付费上游时，Agent 协议面不用变

### 6.3 冷启动阶段先免费，后续升级成分层定价

每个服务都建议做三档：

1. `free`：低频、带缓存、低 SLA
2. `pro`：更实时、更高配额、更完整字段
3. `enterprise`：专属上游、专属告警、专属回调

冷启动时 Platform 可以先把 `free` 档挂出来，等真实调用起来后再逐步加价。

## 7. 推荐优先级：先上哪 5 个，后上哪 15 个

### 7.1 第一波：7 天内必须上线

1. Web3 实时情绪指数
2. 智能合约漏洞深度审计模型
3. 链上巨鲸资金异动监控
4. 协议基本面情报包
5. GitHub 仓库与依赖安全体检

这 5 个足够支撑一个有“货感”的 Demo。

### 7.2 第二波：14 天内补齐

1. Gas 费用与执行窗口建议
2. 稳定币脱锚与储备监控
3. 合约源码/ABI 检索与函数解释
4. 交易解码与意图解释
5. 论文检索与三段式摘要

### 7.3 第三波：市场扩货架

再补余下 10 个，用来证明 Synapse 不是单点工具，而是一个可持续扩展的服务市场。

## 8. Manifest 设计建议

这些冷启动服务在 Synapse 上注册时，建议统一采用以下思路：

1. `service_name` 必须极其直白，避免品牌黑话
2. `description_for_model` 直接说明：输入什么、返回什么、适合什么决策
3. `input_schema` 尽量短，避免首批服务把调用门槛做高
4. `output_schema` 必须结构化，禁止只返回大段 prose
5. `pricing` 先用简单的 per-call 模型，避免复杂阶梯

示例：

```json
{
  "service_name": "web3_sentiment_index",
  "description_for_model": "Return a structured crypto market sentiment score with reasons, volatility signal, and action hints for a token or market segment.",
  "pricing": {
    "model": "per_call",
    "base_price_usdc": "0.01"
  }
}
```

## 9. 上游选择注意事项

免费 API 不等于可以裸奔接入。

平台必须额外做 6 件事：

1. **缓存**：避免被免费配额直接打爆
2. **超时控制**：上游慢就快速失败，不能拖死 Synapse invoke
3. **字段归一**：不同源统一成同一 schema
4. **来源标注**：必要时在结果里带 `sources` 字段
5. **回退策略**：主源挂了自动切备用源或返回降级结果
6. **版权 / ToS 审核**：确认允许合理调用、缓存和转售包装

## 10. 不建议优先做的方向

下面这些不是不能做，而是不该抢在第一批做：

1. 通用天气 API
2. 通用笑话 / 文案生成 API
3. 低价值翻译壳子 API
4. 没有结构化输出的纯摘要 API
5. 强依赖人工解释才能消费的“半成品数据接口”

原因很简单：

**它们不能有效证明 Synapse 的结算和 Agent 调用价值。**

## 11. 执行建议

如果要把冷启动真正跑起来，我建议 Platform 先做下面这套最短路径：

1. 用一个官方 Provider 账号挂 5 个样板服务
2. 每个服务都给出真实可调用的 demo request / response
3. 在 Marketplace 首页给这 5 个服务打 `Platform Verified` 标签
4. 先把 `free / low-price` 调用跑通，再逐步加预算策略和付费升级
5. 让 Agent SDK 示例直接消费这些服务，形成闭环

一句话总结：

**冷启动不是先等第三方 Provider 来救场，而是 Platform 先下场把第一批高价值货盘出来。**

只要这 5 个服务先跑通，Synapse 就不再是“一个空支付壳”，而是一个真正能让 Agent 花钱做事的市场基础设施。