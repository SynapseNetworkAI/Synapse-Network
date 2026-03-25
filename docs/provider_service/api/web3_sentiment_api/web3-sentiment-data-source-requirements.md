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

### 3.2 Binance Public Market Data

角色：

1. 提供更高频的价格波动和成交活跃度
2. 作为当前 token 级动量、成交热度与短周期波动的主来源

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

## 5. 补充候选页面型数据源评估

以下评估针对用户侧常见页面型入口，而不是这些公司的正式付费 API 产品。

### 5.1 评估目标

本次额外评估 3 个公开页面：

1. `Coinglass Fear & Greed Index`
2. `CoinMarketCap Fear & Greed Index`
3. `Bitget Fear & Greed Index`

评估标准不是“页面上有没有一个数字”，而是下面 4 个问题：

1. 是否能稳定覆盖 `市场风险偏好基线`
2. 是否能稳定覆盖 `token 价格与涨跌幅动量`
3. 是否能稳定覆盖 `成交量 / 交易活跃度`
4. 是否能稳定覆盖 `短周期波动率`

同时要看：

1. 页面是否重度前端渲染
2. 是否明显依赖登录、反爬或商业 API 授权
3. 数据是不是该站自己的独立信号，还是别人的镜像展示

### 5.2 结论总表

| 来源 | 风险偏好基线 | 价格动量 | 成交活跃度 | 短周期波动率 | 是否建议直接页面爬取进 runtime |
| --- | --- | --- | --- | --- | --- |
| `Coinglass Fear & Greed` | 可提供 | 不适合直接提供 | 不适合直接提供 | 不适合直接提供 | 否 |
| `CoinMarketCap Fear & Greed` | 可提供 | 不适合直接提供 | 不适合直接提供 | 不适合直接提供 | 否 |
| `Bitget Fear & Greed` | 可提供，但为 `Alternative.me` 镜像 | 不适合直接提供 | 不适合直接提供 | 不适合直接提供 | 否 |

一句话结论：

1. 这 3 个页面都只能勉强覆盖 `市场风险偏好基线`
2. 对 `价格动量 / 成交活跃度 / 短周期波动率` 三类 capability，它们不是合适的主数据源
3. 真正适合 runtime 主干的，仍然应该是 `Alternative.me` 这类明确情绪指数源，加上 `Binance public market data` 这类明确市场数据源

### 5.3 Coinglass Fear & Greed

页面可见信息：

1. 页面公开展示 `Fear & Greed` 当前值、历史区间和方法论
2. 方法论明确写了指数由 `波动率`、`市场动能与成交量`、`社交媒体` 等维度构成
3. 页面底部同时公开展示 `Crypto API` 和定价入口，说明它本身更像商业数据产品前台

可用性判断：

1. 适合作为 `市场风险偏好基线` 的研究参考或商业 API 候选
2. 不适合把页面本身拆成 `价格动量 / 成交量 / 波动率` 三个独立 capability，因为页面只给综合指数叙述，不给稳定结构化原始字段
3. 页面为指标展示页，重度前端渲染和商业化概率较高，直接页面爬取的稳定性、授权边界和 anti-bot 风险都不理想

结论：

1. `Coinglass` 可以列入未来“已授权商业源”候选
2. 不建议把 `Coinglass 页面爬虫` 接成当前 runtime 主干

### 5.4 CoinMarketCap Fear & Greed

页面可见信息：

1. 页面公开展示当前值、昨日、上周、上月以及年度高低点
2. 页面文案直接提到可通过其 `API` 获取实时和历史数据
3. 但当前页面本身主要承载的是 `Fear & Greed` 指标展示，不是 token 级 market data page

可用性判断：

1. 作为 `市场风险偏好基线` 的候选是成立的
2. 对另外 3 类 capability，这个页面本身并不提供可直接落库的稳定结构化字段
3. `CoinMarketCap` 整站有更丰富的价格、成交量、技术指标和衍生品图表，但那已经是另一组 API / 页面，不应和当前 `Fear & Greed` 页面混为一个 source plugin
4. 如果未来要接，应该优先评估 `官方 API 授权`，而不是先做页面爬虫

结论：

1. `CMC Fear & Greed` 页面适合做对账和基线候选调研
2. 不建议直接用页面爬虫作为当前 `baseline_sentiment` 正式 runtime 来源

### 5.5 Bitget Fear & Greed

页面可见信息：

1. 页面公开展示当前值、历史值和更新时间
2. 页面明确写出 `指数来源 Alternative.me`
3. 页面也解释了指数考虑 `波动率`、`市场动量/交易量` 等维度，但当前展示仍是综合指数页

可用性判断：

1. 它能作为 `Alternative.me` 的公开镜像校验页
2. 它不是独立情绪数据源，因为最终值已经明确来自 `Alternative.me`
3. 直接把它接进 runtime，会把同一份上游包装成第二个 source，造成虚假的多源冗余

结论：

1. `Bitget Fear & Greed` 只适合做人工核对或监控告警对照
2. 不应作为独立 source plugin 接入

### 5.6 对 4 类 capability 的最终建议

#### 市场风险偏好基线

建议优先级：

1. `Alternative.me` 继续作为主源
2. 若未来购买授权，可评估 `Coinglass API` 或 `CoinMarketCap API`
3. `Bitget Fear & Greed` 不作为独立源，只能做镜像校验

#### token 价格与涨跌幅动量

建议优先级：

1. `Binance public market data` 继续作为主源
2. 后续可补 `DexScreener` 做链上 token 对照
3. 不建议从上述 3 个 Fear & Greed 页面倒推该 capability

#### 成交量 / 交易活跃度

建议优先级：

1. `Binance ticker/24hr` 继续作为主源
2. `DexScreener` 可作为链上活跃度补充
3. 页面型 Fear & Greed 入口不适合作为这一层的结构化主源

#### 短周期波动率

建议优先级：

1. `Binance klines` 继续作为主源
2. 如未来引入链上场景，可追加 DEX 交易明细或更细粒度 OHLCV 源
3. 页面型 Fear & Greed 入口只适合作为方法论参考，不适合直接提供短周期波动率字段

## 6. 数据质量要求

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

## 7. 输出映射要求

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

## 8. 可用性与降级要求

V1 最低要求：

1. `Alternative.me` 或 `Binance` 任一失败时，可继续返回结果
2. 只要 `Alternative.me` 和 `Binance` 同时失败，就应该返回降级告警或错误，而不是继续假装“实时”
3. 如果所有外部源都失败，可以回退到最近一次快照，但必须显式标记缓存命中和最大老化时间

## 9. 存储要求

后续实现至少要有两层落地：

1. 原始抓取层
   - 保存 source 原始结果、时间戳、状态码、摘要 hash
2. 聚合快照层
   - 保存最终 sentiment snapshot，便于重放和排障

推荐表：

1. `provider_sentiment_raw_feeds`
2. `provider_sentiment_snapshots`
3. `provider_api_invocations`

## 10. 实施优先级

1. 先接 `Alternative.me`
2. 再接 `Binance`
3. 如需新增 `baseline_sentiment` 商业备源，优先评估 `Coinglass API` 或 `CoinMarketCap API` 的授权方案，而不是先做页面爬虫
4. 最后补 `DexScreener` / `DefiLlama` / 社交源增强

原因：先把“可用的真实情绪分”打出来，再做更花的 narrative。