# Provider Shelf Status Table

## 0. Metadata

- Status: active
- Owner: Founder / CTO hat
- Date: 2026-03-30
- Related systems: `provider_service`, `gateway`, `sdk/python`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Readiness_Gap_List.md`
  - `docs/exec-plans/active/2026-03-30_Week1_Today_Checklist.md`
  - `docs/03_Projects/provider-service/README.md`
  - `docs/provider_service/api/README.md`

## 1. Purpose

这张表只做一件事：

**把 Week 1 要求的三服务货架状态，从“感觉差不多”压成可检查的 shelf audit。**

判定字段固定为：

1. `discover`
2. `invoke`
3. `pricing`
4. `demo response`

## 2. Audit Rules

`ready`

1. 仓库里有明确代码入口
2. 有文档契约
3. 有测试或明确的运行时证据
4. 可以直接拿去演示

`partial`

1. 已有一半以上证据
2. 但还缺 gateway discover 接入、对外定价、真实公网入口，或标准对外展示

`missing`

1. 当前仓库和文档都没有稳定落点

## 3. Shelf Table

| Service | Service ID | Discover | Invoke | Pricing | Demo response | Repo evidence | Gap | This-week next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `web3 sentiment` | `svc_web3_sentiment_index` | `ready` | `ready` | `ready` | `ready` | `provider_service/app/api/v1/endpoints/sentiment.py`, `provider_service/tests/test_web3_sentiment_index.py`, `docs/provider_service/api/web3_sentiment_api/web3-sentiment-index.md`, `gateway/examples/register_provider_shelf_services.py` | 已在本地 gateway registry 注册成功，`/api/v1/services/discover?intent=web3` 可见，价格已落库为 `0.01 USDC` | 下一步把它塞进 Hero Demo 主链路 |
| `smart contract audit` | `svc_smart_contract_audit` | `ready` | `ready` | `ready` | `ready` | `provider_service/app/api/v1/endpoints/smart_contract_audit.py`, `provider_service/tests/test_smart_contract_audit.py`, `docs/provider_service/api/smart-contract-audit/smart-contract-audit.md`, `gateway/examples/register_provider_shelf_services.py` | 已在本地 gateway registry 注册成功，`/api/v1/services/discover?intent=audit` 可见，价格已落库为 `0.50 USDC` | 下一步补 audit 用例到演示剧本 |
| `whale-flow monitor` | `svc_whale_flow_monitor` | `ready` | `ready` | `ready` | `ready` | `provider_service/app/api/v1/endpoints/whale_flow_monitor.py`, `provider_service/tests/test_whale_flow_monitor.py`, `docs/provider_service/api/whale-flow-monitor.md`, `gateway/examples/register_provider_shelf_services.py` | 已在本地 gateway registry 注册成功，`/api/v1/services/discover?intent=web3` 可见，价格已落库为 `0.10 USDC` | 下一步补对外展示和 Hero Demo 备选用例 |

## 4. What This Means

这三项服务现在已经不是“只有 runtime 能跑”，而是：

1. `discover` 已有真实返回
2. `invoke` 已有真实 endpoint 和健康探测
3. `pricing` 已落进 gateway registry
4. `demo response` 已有文档和 schema 证据

一句话：

**三项样板服务已经被抬成真实市场货架，下一步该打的是 demo 串联和首批真实调用。**

## 5. Go / No-Go For Week 1

如果按 Week 1 的标准，这张表已经从“审计完成”进一步推进到了“本地 discover 注册完成”。

但如果按对外 demo 和融资标准，仍然还有两件事要补：

1. 把这三项服务至少一项塞进 Hero Demo 正式录屏
2. 把本地注册结果抬成稳定公网 demo 环境事实

## 6. Tomorrow Top 3

1. 把 `web3 sentiment` 塞进 Hero Demo 录屏链路
2. 把本地 registry 结果迁到稳定 demo 环境
3. 跑一轮 discover -> invoke 的端到端演示验证

## 7. Validation Log

### 2026-03-30

- Check: 对照 `provider_service` endpoint、测试、API 契约文档以及 Week 1 checklist 的货架审计要求
- Result: 已形成三项样板服务的首版 shelf audit table
- Follow-up: 已补 `gateway/examples/register_provider_shelf_services.py` 作为注册种子，下一步要把 `partial` 的 discover / pricing 变成真实运行时事实

### 2026-03-30 Runtime Update

- Check: 本地启动 `gateway`，生成 owner JWT，并把三项服务真实注册进 registry
- Result: `svc_web3_sentiment_index`、`svc_smart_contract_audit`、`svc_whale_flow_monitor` 已进入本地 discover 结果
- Follow-up: 把当前本地运行时事实迁移到稳定 demo 环境，并补 Hero Demo 串联

### 2026-03-30 End-to-End Demo Update

- Check: 以 `svc_web3_sentiment_index` 跑通本地 `discover -> quote -> invoke`
- Result: 本地真实成功返回 `invocationId=inv-18dc99a37d124ac7bb0326d2e5609579`，实际扣费 `0.0101 USDC`
- Follow-up: 下一步把这条链路录成正式 Hero Demo，并补 provider income / owner balance 的镜头切换

### 2026-03-30 Second End-to-End Demo Update

- Check: 以 `svc_smart_contract_audit` 跑通本地 `discover -> quote -> invoke`
- Result: 本地真实成功返回 `invocationId=inv-9b2a498c8f984680af8629ea172743ae`，实际扣费 `0.5001 USDC`
- Follow-up: 下一步把 audit 结果页压缩成更适合录屏的输出视图
