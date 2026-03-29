# Web3 Sentiment API 专题

- Status: supplementary
- Canonical counterpart: `docs/03_Projects/provider-service/README.md`
- Why retained: 保留 Web3 Sentiment Index 的实现深链、数据源设计与专题阅读顺序，不重复承担 provider-service 项目入口职责

本目录收敛 `Web3 Sentiment Index` 的当前实现真相、未来数据来源要求，以及后续爬取与聚合设计。

先说结论：

1. `POST /provider-services/web3-sentiment-index/invoke` 已经存在，可被 Gateway 签名调用
2. 当前运行时真实接入的数据源是 `Alternative.me` 与 `Binance public market data`
3. 当前运行时已经改为 capability-based source plugin 结构，聚合层消费 capability signal 而不是硬编码 source 名字
4. 当前运行时已经支持 Postgres 持久化、source telemetry 落库、进程内缓存和 persisted snapshot fallback
5. 当前前台读路径已支持 `fresh / stale-but-servable / expired` 三档 snapshot policy，stale 会返回旧快照并异步 repair
6. 独立后台 scheduler 已接入 `provider_sentiment_scheduler_jobs` 状态表、per-snapshot lease 和 cooldown backoff，Phase 4 运维增强仍待继续

## 文档索引

1. [当前接口设计与实现状态](./web3-sentiment-index.md)
2. [数据来源需求文档](./web3-sentiment-data-source-requirements.md)
3. [抓取与聚合设计文档](./web3-sentiment-crawling-design.md)
4. [独立 Scheduler 设计与实施计划](./web3-sentiment-scheduler-design.md)
5. [候选页面型情绪源评估](./web3-sentiment-data-source-requirements.md#5-补充候选页面型数据源评估)

## 推荐阅读顺序

1. 先读 [当前接口设计与实现状态](./web3-sentiment-index.md)，明确现在已经做了什么、没做什么
2. 再读 [数据来源需求文档](./web3-sentiment-data-source-requirements.md)，确定 V1 必接和可选数据源
3. 再读 [抓取与聚合设计文档](./web3-sentiment-crawling-design.md)，理解当前 request-time fetch 的生产级边界
4. 最后读 [独立 Scheduler 设计与实施计划](./web3-sentiment-scheduler-design.md)，推进 warm snapshot 和后台预抓取架构

补充说明：

1. `Coinglass Fear & Greed`、`CoinMarketCap Fear & Greed`、`Bitget Fear & Greed` 已做页面级可抓取性评估
2. 当前结论是：它们都可以作为研究或对账参考，但不应直接替代当前运行时的 `Alternative.me + Binance` 主干
3. 原因不是“页面没有值”，而是 capability 覆盖不完整，且页面抓取稳定性、授权边界与 anti-bot 风险都弱于明确的 API 型来源