# Web3 Sentiment API 专题

本目录收敛 `Web3 Sentiment Index` 的当前实现真相、未来数据来源要求，以及后续爬取与聚合设计。

先说结论：

1. `POST /provider-services/web3-sentiment-index/invoke` 已经存在，可被 Gateway 签名调用
2. 当前返回的是结构化情绪结果，但还不是多源实时情绪抓取系统
3. 现在没有数据库落地，只有进程内 5 分钟缓存和 provider 日志
4. `Alternative.me`、`CoinGecko`、`Binance public market data` 目前只出现在返回元数据与设计文档里，还没有真实接入

## 文档索引

1. [当前接口设计与实现状态](./web3-sentiment-index.md)
2. [数据来源需求文档](./web3-sentiment-data-source-requirements.md)
3. [抓取与聚合设计文档](./web3-sentiment-crawling-design.md)

## 推荐阅读顺序

1. 先读 [当前接口设计与实现状态](./web3-sentiment-index.md)，明确现在已经做了什么、没做什么
2. 再读 [数据来源需求文档](./web3-sentiment-data-source-requirements.md)，确定 V1 必接和可选数据源
3. 最后读 [抓取与聚合设计文档](./web3-sentiment-crawling-design.md)，按阶段推进真实实现