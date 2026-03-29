# Provider Service API 拆分文档

- Status: supplementary
- Canonical counterpart: `docs/03_Projects/provider-service/README.md`
- Why retained: 保留 provider-service 细粒度服务专题导航和 API 设计深链，不重复承担项目导航与运行边界真相

本目录将首批 5 个 Provider API 的接口设计按服务拆分为独立文档，便于：

1. 单服务评审与迭代
2. 后续直接映射到 Gateway 调用契约
3. Provider 侧逐个服务落地实现

通用约束与统一骨架仍以以下文档为主：

1. [Provider Service 首批 5 个服务契约草案](../SERVICE_DRAFTS.md)
2. [Provider Service 冷启动免费 API 方案设计](../README.md)

## 文档索引

1. [Web3 实时情绪指数专题](./web3_sentiment_api/README.md)
2. [协议基本面情报包](./protocol-fundamental-brief/README.md)
3. [链上巨鲸资金异动监控](./whale-flow-monitor.md)
4. [开源仓库与依赖安全体检](./smart-contract-audit/oss-security-healthcheck.md)
5. [智能合约漏洞深度审计模型](./smart-contract-audit/README.md)
6. [Twitter 视频下载服务设计](./twitter-video-download-service-design.md)
7. [YouTube 视频下载服务设计](./youtube-video-download-service-design.md)
8. [TikTok 视频下载服务设计](./tiktok-video-download-service-design.md)
9. [下载类接口扩展需求挖掘（Agent 生态）](./agent-download-demand-expansion.md)

实现设计（已落地）：

1. [Whale Flow Monitor 实现设计](./whale-flow-monitor-implementation-design.md)
2. [OSS Security Healthcheck 实现设计](./oss-security-healthcheck-implementation-design.md)
3. [Whale + OSS 数据库设计](./provider-runtime-whale-oss-db-design.md)
4. [TikTok Video Download 实现（与设计同页）](./tiktok-video-download-service-design.md)

如果你要直接联调 `Web3 Sentiment Index`，参数说明与签名 `curl` 示例已经补到：

1. [web3_sentiment_api/web3-sentiment-index.md](./web3_sentiment_api/web3-sentiment-index.md)

## 统一接口约定

所有服务默认遵守以下统一接口边界：

1. `POST /invoke`
2. `GET /health`
3. 统一返回顶层骨架：`service`、`sources`、`freshness`、`result`、`errors`
4. V1 统一采用 `fixed` 按次计费
5. V1 优先同步调用，除特殊服务外不引入复杂异步编排

## 推荐实现顺序

1. `svc_web3_sentiment_index`
2. `svc_protocol_fundamental_brief`
3. `svc_whale_flow_monitor`
4. `svc_oss_security_healthcheck`
5. `svc_smart_contract_audit`
