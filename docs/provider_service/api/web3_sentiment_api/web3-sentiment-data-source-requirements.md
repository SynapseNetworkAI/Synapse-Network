# Web3 实时情绪指数数据来源需求文档

## 1. 目标

本文件定义 `Web3 Sentiment Index` 从“规则 demo”升级到“真实多源情绪服务”时，必须满足的数据来源要求。

核心目标：

1. 输出不是单一价格接口透传，而是统一情绪结果
2. 数据至少覆盖市场基线、价格动量、成交热度、短周期波动四类信号
3. 任一单一源故障时，系统仍能退化返回结果，而不是直接瘫痪

## 2. 必需信号层

V1 至少要有以下 4 类信号：

1. 市场风险偏好基线
2. token 价格与涨跌幅动量
3. 成交量 / 交易活跃度
4. 短周期波动率

如果缺失其中任意两类，输出就不应再被命名为“实时情绪指数”。

## 3. V1 必接来源

### 3.1 Alternative.me Fear & Greed Index

角色：

1. 提供全市场风险偏好基线
2. 作为 `sentiment_label` 的初始锚点

必需字段：

1. 当前指数值
2. 指数标签
3. 更新时间

要求：

1. 最大容忍源老化时间：`1800s`
2. 若超时或失败，可继续返回结果，但必须下调结果置信度

### 3.2 CoinGecko

角色：

1. 提供 token 价格、涨跌幅、成交量、market cap 等横截面数据
2. 支撑 `symbol` 级别的强弱判断

必需字段：

1. 当前价格
2. `24h` 涨跌幅
3. `24h` 成交量
4. market cap 或 rank
5. 更新时间

要求：

1. 最大容忍源老化时间：`60s`
2. 必须支持 `BTC`、`ETH`、`SOL`
3. 后续要预留 symbol 映射层，避免上游 id 和对外 symbol 耦合

### 3.3 Binance Public Market Data

角色：

1. 提供更高频的价格波动和成交活跃度
2. 弥补 `CoinGecko` 在分钟级实时性上的不足

必需字段：

1. latest ticker
2. `24h` volume
3. 短周期 kline，例如 `5m` / `15m` / `1h`
4. 更新时间

要求：

1. 最大容忍源老化时间：`10s`
2. 至少支撑 `BTCUSDT`、`ETHUSDT`、`SOLUSDT`

## 4. V1 可选增强来源

### 4.1 DexScreener

用途：

1. 提供链上交易热度与池子深度补充
2. 适合未来做链生态热度偏置

### 4.2 DefiLlama

用途：

1. 作为协议与链生态层面的背景信号
2. 适合未来做 `chain` 维度增强评分

### 4.3 社交情绪源

用途：

1. 用于更高阶版本的 narrative 情绪增强
2. V1 不强制，避免把实现复杂度炸穿

## 5. 数据质量要求

每个 source adapter 都必须输出：

1. `source_name`
2. `fetched_at`
3. `source_timestamp`
4. `latency_ms`
5. `success`
6. `staleness_sec`
7. `payload_hash` 或可等价追踪字段

这样后续才能排查：

1. 是哪个源慢
2. 是哪个源脏
3. 是哪个源挂了

## 6. 输出映射要求

V1 最终统一输出至少包含：

1. `sentiment_score`
2. `sentiment_label`
3. `trend_direction`
4. `volatility_signal`
5. `reasoning_bullets`
6. `freshness.generatedAt`
7. `freshness.maxSourceAgeSec`
8. `sources[].name`
9. `sources[].freshnessSec`

设计原则：

1. 上游字段不能直接泄漏为长期外部契约
2. 所有 source adapter 都必须先映射到内部统一中间结构
3. 统一结果由 Synapse provider 层负责生成，而不是让某个上游决定最终语义

## 7. 可用性与降级要求

V1 最低要求：

1. `Alternative.me` + `CoinGecko` 任一失败时，可继续返回结果
2. 只要 `CoinGecko` 和 `Binance` 同时失败，就应该返回降级告警或错误，而不是继续假装“实时”
3. 如果所有外部源都失败，可以回退到最近一次快照，但必须显式标记缓存命中和最大老化时间

## 8. 存储要求

后续实现至少要有两层落地：

1. 原始抓取层
   - 保存 source 原始结果、时间戳、状态码、摘要 hash
2. 聚合快照层
   - 保存最终 sentiment snapshot，便于重放和排障

推荐表：

1. `provider_sentiment_raw_feeds`
2. `provider_sentiment_snapshots`
3. `provider_api_invocations`

## 9. 实施优先级

1. 先接 `Alternative.me`
2. 再接 `CoinGecko`
3. 再接 `Binance`
4. 最后补 DexScreener / DefiLlama / 社交源增强

原因：先把“可用的真实情绪分”打出来，再做更花的 narrative。