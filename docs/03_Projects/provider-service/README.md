# provider-service

- Status: canonical
- Code paths: `provider_service/`, `docs/03_Projects/provider-service/`, `docs/provider_service/`
- Verified with: `npm run ci:provider-service`, `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 项目定位

`provider_service/` 是 Synapse 用来演示与验证 Provider Runtime 接入路径的独立微服务样板工程。

它负责：

1. 提供可独立部署的 Provider API
2. 验证 `gateway -> provider runtime` 的真实调用链路
3. 承接未来首批样板服务的独立实现骨架

一句话：它不是网关，也不是 SDK，而是被网关调用的服务提供方样板。

## 2. 代码位置

- 项目目录：`provider_service/`
- 本地说明：`provider_service/README.md`
- 本地规则镜像：`provider_service/AGENTS.md`
- 应用代码：`provider_service/app/`
- 测试目录：`provider_service/tests/`

## 3. 当前状态

当前运行时已经从早期 quotes demo 扩展为多 endpoint Provider Runtime：

1. `GET /health`
2. `POST /provider-services/web3-sentiment-index/invoke`
3. `POST /provider-services/protocol-fundamental-brief/invoke`
4. `POST /api/v1/quotes/famous`
5. `POST /api/v1/quotes/famous/top3`

其中：

1. `provider-services/*` 是当前面向 Gateway 签名调用的主运行时入口
2. `quotes/*` 仍保留为早期 demo / smoke path，不再代表 provider_service 的主要产品方向
3. 当前目标是继续把 Provider Runtime 演进为标准化样板服务宿主，而不是停留在单一 quotes demo

## 4. 职责边界

`provider_service/` 应该承担：

1. 对外提供稳定、可测试的 Provider API
2. 统一请求模型、错误映射、日志与本地缓存策略
3. 与 `gateway/` 保持标准 HTTP 协议边界

`provider_service/` 不应该承担：

1. 平台扣费、预算、账本与结算
2. 服务注册控制面
3. 管理员控制面
4. SDK 客户端封装

## 5. 直接依赖关系

1. 被 `gateway/` 作为 Provider Runtime 调用
2. 受根 `docs/provider_service/` 的冷启动规划与服务契约约束
3. 与 `sdk/python/` 共同服务于端到端演示链路，但层级不同

## 6. Canonical 文档入口

1. `docs/provider_service/README.md`：冷启动服务策略、服务货架与专题入口，不承担项目导航
2. `docs/provider_service/SERVICE_DRAFTS.md`
3. `docs/provider_service/api/README.md`
4. `docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`

## 7. 项目内贴身文档

根 `docs/03_Projects/provider-service/` 当前集中维护：

1. [Provider_Service_Local_Development.md](./Provider_Service_Local_Development.md)
2. [Provider_Service_Operations_Runbook.md](./Provider_Service_Operations_Runbook.md)
3. [Provider_Service_Agent_Rules.md](./Provider_Service_Agent_Rules.md)

当前项目目录内只保留：

1. `provider_service/README.md`
2. `provider_service/AGENTS.md`

其中 `provider_service/README.md` 现在只保留入口壳；原 `provider_service/docs/` 正文已迁入根 `docs/03_Projects/provider-service/`。