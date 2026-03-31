# 协议基本面情报包实现设计文档

## 1. 设计目标

本设计文档回答的不是“返回什么字段”，而是“如何把公开协议数据稳定聚合成一个可售卖的结构化 brief”。

目标：

1. 让 `Protocol Fundamental Brief` 成为一个 research object service，而不是原始数据透传接口
2. 维持 Provider runtime 的清晰分层，不把 source 抓取、协议识别、summary 生成和缓存逻辑揉成一个大文件
3. 为后续 `peer comparison`、`risk flagging`、快照落库与 warm cache 预留扩展结构

## 2. 服务边界

这个服务负责：

1. 协议识别与标准化
2. 拉取价格、TVL、收入或活跃度等公开数据
3. 生成结构化摘要与结论
4. 返回 freshness、sources、errors 等统一骨架

这个服务不负责：

1. 输出完整原始上游 payload
2. 生成长篇投研报告
3. 替代 Gateway 侧计费、授权或预算逻辑
4. 把所有 research 语义做成 LLM 自由发挥文本

## 3. Capability 设计

建议把该接口内部能力拆成 5 类 capability：

1. `protocol_identity`
   - 解决协议别名、slug、token symbol 与 chain 的归一化
2. `price_context`
   - 输出价格位置、近端动量、相对窗口表现
3. `tvl_context`
   - 输出 TVL 水平、趋势、跨链收缩或扩张情况
4. `revenue_activity_context`
   - 输出收入、费用、使用活跃度等经营侧信号
5. `risk_context`
   - 输出治理、集中度、流动性、链依赖等风险标记

对外 Manifest 可以继续保留当前 5 个高层 capability 名字，但 Provider runtime 内部建议使用上面这套更贴近实现的 capability 分层。

## 4. Source Plugin 设计

建议复用 `web3_sentiment_index` 已经验证过的 capability-based source plugin 结构。

目标结构：

1. `source adapters`
   - 负责请求上游、timeout、retry、payload excerpt 和错误规范化
2. `source plugins`
   - 声明自己提供哪些 capability
3. `brief aggregator`
   - 按 capability 选择 freshest usable observation，生成最终 brief

建议 V1 source：

1. `defillama_protocol`
   - 提供 `protocol_identity`、`tvl_context`、部分 `revenue_activity_context`
2. `dexscreener_market`
   - 提供 `price_context`、部分 `revenue_activity_context`

更细的 endpoint、字段和 pair 选择策略见：[Source Capability Matrix](./source-capability-matrix.md)

未来可选 source：

1. `tokenterminal` 或同类授权数据源
   - 用于增强收入质量和估值框架
2. `defillama_yields` / `fees` / `revenues` 等更细分数据
   - 用于增强策略层解释

## 5. 输入归一化设计

`protocol` 不是稳定主键，必须做归一化。

建议流程：

1. 接收原始 `protocol`
2. 先按显式配置的 alias map 做静态映射
3. 再尝试匹配 DefiLlama protocol slug / name
4. 如给了 `chain`，则进一步裁剪 multi-chain 结果
5. 无法唯一识别时，返回可解释错误，而不是猜测

建议内部对象：

```json
{
  "protocol_id": "aave",
  "display_name": "Aave",
  "chain_scope": "multi-chain",
  "token_symbols": ["AAVE"],
  "aliases": ["aave", "aave protocol"]
}
```

## 6. 统一中间对象

每个 source plugin 应输出统一 observation，而不是直接拼最终 response。

建议结构：

```json
{
  "source": "defillama_protocol",
  "capabilities": ["protocol_identity", "tvl_context", "revenue_activity_context"],
  "fetched_at": "2026-03-24T12:00:00Z",
  "source_timestamp": "2026-03-24T11:58:40Z",
  "latency_ms": 320,
  "retry_count": 0,
  "timeout_ms": 3000,
  "payload_hash": "sha256:...",
  "signals": {
    "protocol_slug": "aave",
    "tvl_usd": 18340000000,
    "tvl_change_7d_pct": 2.4,
    "tvl_change_30d_pct": 5.8,
    "fees_30d_usd": 14800000,
    "revenue_30d_usd": 6200000
  }
}
```

## 7. 聚合与摘要生成

brief aggregator 不应让 LLM 自由生成整份结果，而应先基于规则生成结构化判断，再产出短摘要。

建议流程：

1. 聚合 `price_context`
   - 判断价格在观察窗口的位置、最近 72h 动量是否放缓或加速
2. 聚合 `tvl_context`
   - 判断 TVL 是扩张、持平还是收缩
3. 聚合 `revenue_activity_context`
   - 判断费用与使用信号是稳定、改善还是恶化
4. 聚合 `peer comparison`
   - 若提供 `peer_set`，对 TVL 趋势、价格表现、收入信号做相对比较
5. 聚合 `risk_context`
   - 输出治理、流动性、链依赖、集中度等风险标记
6. 最终生成 `operator_view`
   - 用一句高密度结论描述这个 brief 是否适合继续深入研究

规则优先，文本随后：

1. 先产出枚举或标签
2. 再由模板生成 `price_summary`、`tvl_summary`、`revenue_signals`
3. 这样更适合测试和回归，不会把行为藏进 prompt 里

## 8. freshness 与缓存

建议两层缓存：

1. 进程内短缓存
   - 用于相同 `protocol + chain + lookback_days + peer_set` 高频请求
2. 持久化 brief snapshot
   - 用于进程重启后的 fallback 和热协议复用

建议 freshness 语义：

1. `generatedAt`
   - brief 生成时间
2. `maxSourceAgeSec`
   - 本次使用 source observation 中最老的 age
3. `cacheHit`
   - 是否命中 snapshot / in-memory cache

## 9. 错误与降级策略

建议降级规则：

1. `DefiLlama` 成功、`DexScreener` 失败
   - 仍可输出 TVL 和部分经营信号，但价格摘要需显式降级
2. `DexScreener` 成功、`DefiLlama` 失败
   - 仍可输出价格上下文，但 `tvl_summary` 和部分 peer comparison 要降级
3. 两个核心源都失败
   - 优先回退到最近 snapshot；如果没有 snapshot，则返回可解释错误

错误记录建议统一保留：

1. `code`
2. `message`
3. `source_name`
4. 是否影响核心 capability

## 10. 存储设计

建议至少有两层持久化：

1. `provider_api_invocations`
   - 保存对外调用记录
2. `provider_protocol_briefs`
   - 保存最终 response snapshot
3. 可选 `provider_protocol_brief_raw_feeds`
   - 保存 source observation 摘要，便于排障和回放

如果后续要做 scheduler 预热，第三张表会明显更值钱。

落地约束：

1. 表结构通过 `docker-compose/postgres/init/gateway-providers/001_provider_schema.sql` 显式初始化
2. runtime repository 不允许隐式执行 `CREATE TABLE` / `ALTER TABLE`

## 11. 推荐目录结构

建议后续代码结构：

```text
provider_service/app/
  services/
    protocol_fundamental_brief_service.py
    protocol_fundamental_brief/
      adapters.py
      plugins.py
      aggregator.py
      repository.py
      cache.py
      aliases.py
```

## 12. V1 设计结论

V1 要求很明确：

1. 先用 `DefiLlama + DexScreener` 打出一个稳定、可解释、可缓存的结构化 brief
2. 不急着追求完美收入模型或复杂估值体系
3. 先把 `协议识别 -> source plugin -> 聚合 -> brief 输出 -> snapshot 落库` 这条主链打通
