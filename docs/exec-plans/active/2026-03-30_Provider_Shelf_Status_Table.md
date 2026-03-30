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
| `web3 sentiment` | `svc_web3_sentiment_index` | `partial` | `ready` | `partial` | `ready` | `provider_service/app/api/v1/endpoints/sentiment.py`, `provider_service/tests/test_web3_sentiment_index.py`, `docs/provider_service/api/web3_sentiment_api/web3-sentiment-index.md` | 已有注册种子脚本，但仍缺确认它已进入 gateway discover 结果；定价还没变成真实 registry 记录 | 运行 `gateway/examples/register_provider_shelf_services.py`，并验证 discover 输出 |
| `smart contract audit` | `svc_smart_contract_audit` | `partial` | `ready` | `partial` | `ready` | `provider_service/app/api/v1/endpoints/smart_contract_audit.py`, `provider_service/tests/test_smart_contract_audit.py`, `docs/provider_service/api/smart-contract-audit/smart-contract-audit.md` | endpoint 和 demo response 已有，且已有注册种子脚本；但 discover 接入与正式 price card 仍未看到运行时证明 | 运行注册脚本并核验 price card / discover 结果 |
| `whale-flow monitor` | `svc_whale_flow_monitor` | `partial` | `ready` | `partial` | `ready` | `provider_service/app/api/v1/endpoints/whale_flow_monitor.py`, `provider_service/tests/test_whale_flow_monitor.py`, `docs/provider_service/api/whale-flow-monitor.md` | 有 invoke、快照、调用审计和 demo response，且已有注册种子脚本；但 discover 与正式定价仍像文档草案 | 运行注册脚本并核验 discover 展示页与正式 per-call 定价 |

## 4. What This Means

这三项服务现在已经不是“没有东西”，而是：

1. `invoke` 维度已经能打
2. `demo response` 维度已经能讲
3. 真正还没收口的是 `discover` 和 `pricing`

一句话：

**现在最缺的不是再写一个新服务，而是把现有三项服务从运行时能力，抬成真正的市场货架。**

## 5. Go / No-Go For Week 1

如果按 Week 1 的标准，这张表已经满足“货架现状审计已存在”。

但如果按对外 demo 和融资标准，这张表还不够，因为下面两件事仍未完成：

1. 至少一个真实 discover 画面或 discover API 输出
2. 至少一版正式 price card 或 manifest 注册结果

## 6. Tomorrow Top 3

1. 让三项服务至少一项真实出现在 discover 结果里
2. 锁三项服务的首版对外价格
3. 把其中一项服务塞进 Hero Demo 录屏链路

## 7. Validation Log

### 2026-03-30

- Check: 对照 `provider_service` endpoint、测试、API 契约文档以及 Week 1 checklist 的货架审计要求
- Result: 已形成三项样板服务的首版 shelf audit table
- Follow-up: 已补 `gateway/examples/register_provider_shelf_services.py` 作为注册种子，下一步要把 `partial` 的 discover / pricing 变成真实运行时事实
