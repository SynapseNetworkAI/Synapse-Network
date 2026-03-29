# 协议基本面情报包专题

- Status: supplementary
- Canonical counterpart: `docs/03_Projects/provider-service/README.md`
- Why retained: 保留 Protocol Fundamental Brief 的接口契约、实现设计与阶段计划深链，不重复承担 provider-service 项目入口职责

本专题收敛 `Protocol Fundamental Brief` 的接口契约、实现设计与落地计划。

先说结论：

1. 这个服务不是原始行情透传接口，而是一个给 Agent 使用的协议基本面结构化 brief 服务
2. 它负责把 `DefiLlama`、`DexScreener` 等公开数据压缩成价格摘要、TVL 摘要、收入信号、同类对比与风险标记
3. V1 的目标不是生成长篇投研报告，而是输出可消费、可缓存、可快速决策的 research object

## 文档索引

1. [接口契约草案](./protocol-fundamental-brief.md)
2. [实现设计文档](./implementation-design.md)
3. [Source Capability Matrix](./source-capability-matrix.md)
4. [实现计划](./implementation-plan.md)

## 推荐阅读顺序

1. 先读 [接口契约草案](./protocol-fundamental-brief.md)，明确输入输出和对外服务边界
2. 再读 [实现设计文档](./implementation-design.md)，理解 source、capability、聚合与缓存设计
3. 再读 [Source Capability Matrix](./source-capability-matrix.md)，明确 `DefiLlama / DexScreener` 的字段边界和 capability 归属
4. 最后读 [实现计划](./implementation-plan.md)，按阶段推进 Provider 侧落地

## 当前边界

1. 当前专题仍处于实现迭代期，但 `provider_service` 已经落地 signed endpoint、source adapter/plugin wiring，以及 Phase 3 的规则驱动聚合输出
2. 当前建议的 V1 主来源是 `DefiLlama + DexScreener`
3. 当前 `sources`、`freshness`、`errors` 反映真实上游采集结果，`result` 已切换为 alias-normalized、规则驱动的结构化 brief
4. `peer_set` 会优先基于 DefiLlama protocol-level observation 生成相对比较，不会退化成自由文本 prompt
5. 后续如要增强 `revenue_signal_summary` 与 `risk_flagging`，应继续沿用 capability-based source plugin 结构，而不是把所有上游逻辑塞回一个 service 文件