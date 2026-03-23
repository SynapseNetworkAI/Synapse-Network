# Provider Service API 拆分文档

本目录将首批 5 个 Provider API 的接口设计按服务拆分为独立文档，便于：

1. 单服务评审与迭代
2. 后续直接映射到 Gateway 调用契约
3. Provider 侧逐个服务落地实现

通用约束与统一骨架仍以以下文档为主：

1. [Provider Service 首批 5 个服务契约草案](../SERVICE_DRAFTS.md)
2. [Provider Service 冷启动免费 API 方案设计](../README.md)

## 文档索引

1. [Web3 实时情绪指数](./web3-sentiment-index.md)
2. [协议基本面情报包](./protocol-fundamental-brief.md)
3. [链上巨鲸资金异动监控](./whale-flow-monitor.md)
4. [开源仓库与依赖安全体检](./oss-security-healthcheck.md)
5. [智能合约漏洞深度审计模型](./smart-contract-audit.md)

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