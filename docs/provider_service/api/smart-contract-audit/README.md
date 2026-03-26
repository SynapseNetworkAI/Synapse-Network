# 智能合约漏洞深度审计模型专题

- Status: supplementary
- Canonical counterpart: `docs/03_Projects/provider-service/README.md`
- Why retained: 保留 Smart Contract Audit 的接口契约、实现设计与调用示例深链，不重复承担 provider-service 项目入口职责

本专题收敛 `Smart Contract Audit Model` 的接口契约、实现设计与当前可调用路径。

先说结论：

1. 这个服务卖的不是 raw scanner 输出，而是结构化风险结论、攻击面摘要和修复建议
2. 当前 `provider_service` 已落地 `POST /provider-services/smart-contract-audit/invoke`
3. V1 已支持 `source_bundle` 直传源码分析，以及 `contract_address + chain -> Sourcify -> Blockscout -> Etherscan` 的 verified-source fallback 地址模式，不把链上抓源码逻辑硬编码进 router

## 文档索引

1. [接口契约草案](./smart-contract-audit.md)
2. [实现设计文档](./implementation-design.md)

## 当前边界

1. 当前分析内核是 deterministic rule engine，不依赖 LLM 黑盒输出
2. 当前结果统一返回 `service`、`sources`、`freshness`、`result`、`errors`
3. `analysis_depth=fast` 只跑高价值高命中规则；`standard` 会扩展到时间依赖、弱随机数、升级入口等补充检查
4. 代码结构保持 `router -> schema -> service -> adapter/analyzer` 分层；当前已接 `Sourcify / Blockscout / Etherscan` 多源 verified-source fetch，不会把外部 provider 逻辑泄漏到 HTTP 边界
5. 成功请求当前会写 `provider_contract_audit_reports`，成功和失败请求都会写 `provider_api_invocations`
6. 两张表的 `observability_json` 当前会落 `resolvedSourceProvider` 与 `fallbackAttempts`
