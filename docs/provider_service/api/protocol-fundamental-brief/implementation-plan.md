# 协议基本面情报包实现计划

## 1. 目标

本计划用于把 `svc_protocol_fundamental_brief` 从文档草案推进到 Provider runtime 可运行版本。

交付目标：

1. 提供 `POST /provider-services/protocol-fundamental-brief/invoke`
2. 返回统一骨架：`service`、`sources`、`freshness`、`result`、`errors`
3. 支持 `protocol`、`chain`、`peer_set`、`lookback_days`
4. 接入 `DefiLlama + DexScreener` 的 V1 source plugin
5. 具备 snapshot cache、基础测试和运行文档

实现前置输入：

1. `DefiLlama / DexScreener` 的 capability、endpoint、字段、pair 选择和降级边界，以 [Source Capability Matrix](./source-capability-matrix.md) 为准

## 2. 分阶段实施

### Phase 0. 文档与契约冻结

目标：

1. 冻结 Manifest、input schema、output schema
2. 冻结 V1 source 范围和 capability 边界
3. 明确非目标项，避免边做边膨胀

交付：

1. 接口契约文档
2. 实现设计文档
3. Source Capability Matrix
4. 实现计划文档

完成标准：

1. 团队确认 V1 只做 `DefiLlama + DexScreener`
2. 团队确认不做长报告、评分模型和复杂 LLM 编排

### Phase 1. Schema 与服务骨架

目标：

1. 新增 request / response schema
2. 新增 router 与 service skeleton
3. 接入统一 Gateway-signed 认证边界

任务：

1. 新增 `app/schemas/protocol_fundamental_brief.py`
2. 新增 endpoint 和 service wiring
3. 定义 `ErrorRecord`、`SourceRecord`、`FreshnessRecord` 复用方式

完成标准：

1. 本地 endpoint 可返回 stub response
2. 签名校验与 422 行为符合 Provider 统一约束

### Phase 2. Source Adapter 与 Plugin 层

目标：

1. 接通 `DefiLlama` adapter
2. 接通 `DexScreener` adapter
3. 建立 capability-based source plugin registry

任务：

1. 实现 timeout、retry、backoff
2. 产出统一 observation 对象
3. 记录 payload excerpt、payload hash、source timestamp

完成标准：

1. 两个 source 都可独立单测
2. source failure 能输出规范 error
3. plugin registry 能声明 capability 覆盖

### Phase 3. 协议识别与聚合逻辑

目标：

1. 完成协议 alias / slug 归一化
2. 完成 `price_summary`、`tvl_summary`、`revenue_signals` 生成
3. 完成 `peer_comparison` 与 `risk_flags` 的 V1 规则版输出

任务：

1. 建立 alias map
2. 实现 observation -> brief aggregation
3. 将文本生成限制在模板化和规则驱动范围内

完成标准：

1. `Aave`、`Uniswap`、`Lido` 等样例能稳定返回结构化 brief
2. `peer_set` 生效时能给出相对比较
3. 结果文本稳定，不依赖自由 prompt

### Phase 4. 缓存、持久化与降级

目标：

1. 增加 in-memory cache
2. 增加 brief snapshot repository
3. 增加 source failure fallback 逻辑

任务：

1. 定义 snapshot key
2. 写入 `provider_protocol_briefs`
3. 可选写入 `provider_protocol_brief_raw_feeds`
4. 通过 `docker-compose/postgres/init/gateway-providers/` 增加显式 DDL，而不是在 repository 内自动建表

完成标准：

1. 缓存命中时 freshness 正确
2. source 全挂时可回退到最近 snapshot
3. 错误路径可测试、可解释

### Phase 5. 测试与文档闭环

目标：

1. 覆盖 schema、adapter、plugin、service、endpoint 的核心回归
2. 同步运行文档和 API 文档
3. 确保后续新增 source 不会破坏当前契约

任务：

1. 单测协议识别
2. 单测 source plugin capability 映射
3. 单测降级与 snapshot fallback
4. 单测 endpoint 返回结构

完成标准：

1. 关键路径测试齐全
2. 文档、实现、测试没有漂移

## 3. 任务拆分建议

建议按下面顺序拆 PR：

1. PR1: schema + endpoint stub + docs
2. PR2: DefiLlama / DexScreener adapters + plugins
3. PR3: aggregator + alias normalization + endpoint integration
4. PR4: cache + repository + fallback
5. PR5: tests hardening + runbook sync

这样能避免一个超大 PR 同时改 schema、source、聚合、存储和文档。

## 4. 风险点

### 4.1 协议识别歧义

风险：

1. 同一个协议名可能映射多个 token、多个链或多个 DefiLlama slug

应对：

1. 先用 alias map 解决高频协议
2. 无法唯一识别时返回可解释错误，不做猜测

### 4.2 收入信号不完整

风险：

1. `DefiLlama + DexScreener` 对收入信号的覆盖不一定稳定

应对：

1. V1 明确允许 `revenue_signals` 降级为 usage/activity proxy
2. 后续通过授权数据源增强，不在 V1 强行做满分方案

### 4.3 文本摘要漂移

风险：

1. 如果过早引入 LLM 自由生成，会导致测试脆弱、行为不稳

应对：

1. V1 用规则 + 模板
2. 把语言生成限制在小范围可预测文本模板内

### 4.4 上游抖动

风险：

1. 免费 API 会抖动、限频、字段变化

应对：

1. 每个 source 都要有 timeout、retry、payload excerpt 和错误隔离
2. 通过 snapshot fallback 保住接口稳定性

## 5. V1 验收标准

满足下面条件即可认为 V1 可用：

1. 能对至少 3 个主流协议稳定返回 brief
2. `DefiLlama` 或 `DexScreener` 单源失败时仍能降级返回
3. 所有结果都带 `sources`、`freshness`、`errors`
4. 关键路径有自动化测试
5. 文档、实现、测试同步收敛

## 6. 下一步建议

最务实的起手顺序：

1. 先把 schema 和 endpoint stub 落地
2. 再实现 `DefiLlama` adapter 与 alias normalization
3. 然后接 `DexScreener`，把 brief aggregator 打通
4. 最后再补 snapshot repository 和 fallback