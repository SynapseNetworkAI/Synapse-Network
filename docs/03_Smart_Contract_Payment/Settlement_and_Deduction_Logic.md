# Settlement and Deduction Logic

> 这份文档定义 Synapse 结算与扣费系统的 canonical target-state。旧的双边角色叙事、合并历史稿和兼容性说明已废弃，后续代码重构以本文为准。

## 1. 设计原则

Synapse 的结算与扣费必须坚持四条原则：

1. **Owner owns funds**
2. **Agent consumes budget, not wallet keys**
3. **Provider earnings are separate from consumer spendable balance**
4. **Platform settles through ledger events, not implicit balance mutation**

## 2. 资金生命周期

同一笔资金可能经历三个阶段：

1. 入金进入 Owner consumer balance
2. 被 Agent Runtime 消费并转化为 Provider earnings + Platform fee
3. 被 Owner 作为 consumer refund 或 provider withdrawal 提回链上钱包

这三阶段不能混成一个状态机。

## 3. 扣费主流程

### 3.1 Discovery

Discovery 不扣费，只提供决策输入。

### 3.2 Quote

Quote 不做最终结算，但可做预算预检或额度占用。

### 3.3 Invoke

Invoke 是正式扣费点。

成功调用后，Platform 在一个原子事务内执行：

1. 校验 Credential
2. 校验 Budget Policy
3. 校验 Owner consumer balance
4. 写 invocation receipt
5. 写 ledger entries
6. 写 audit event

## 4. 账本分录规则

一次成功调用至少生成三条分录：

1. `consumer_charge`
2. `provider_earning`
3. `platform_fee_capture`

设：

- `unit_price = P`
- `fee_rate = r`
- `platform_fee = P * r`
- `provider_net = P - platform_fee`

则：

1. `consumer_available -= P`
2. `provider_receivable += provider_net`
3. `platform_fee += platform_fee`

## 5. 失败与回滚

### 5.1 上游失败

若上游执行失败且策略为不计费：

1. 不产生最终 charge capture
2. 释放任何 reservation
3. 写失败审计事件

### 5.2 已扣费后补偿

若系统策略允许先扣后补：

1. 先写 charge capture
2. 再写 compensation / refund event
3. 禁止直接静默回改历史分录

## 6. Refund 逻辑

Refund 是 Owner 消费侧余额出金，不是 Provider Settlement。

### 6.1 退款对象

只允许动：

1. `consumer_available`
2. `consumer_locked`

### 6.2 状态流转

1. `consumer_available -> consumer_locked`
2. 生成 refund intent
3. 链上 withdraw 完成
4. `consumer_locked -> externalized`

### 6.3 硬约束

1. Refund 不允许动 `provider_receivable`
2. Refund 不允许从 platform fee 池出账
3. Refund 必须 route-back 到 owner wallet

## 7. Provider Withdrawal 逻辑

Provider Withdrawal 是同一个 Owner 在 Provider role 下的收益出金。

### 7.1 提现对象

只允许动：

1. `provider_receivable`
2. `provider_locked`

### 7.2 状态流转

1. `provider_receivable -> provider_locked`
2. 生成 withdrawal intent
3. 链上 withdraw / claim 完成
4. `provider_locked -> externalized`

### 7.3 硬约束

1. Withdrawal 不允许动 `consumer_available`
2. Withdrawal 不允许消耗 refund 锁仓
3. Withdrawal 与 refund 即使归属同一个 owner，也必须走独立 intent 与独立 replay-protection

## 8. 同一个 Owner 同时消费和供给

这不是边缘场景，而是目标常态。

同一个 Owner 可以同时拥有：

1. 多个 Agent
2. 多个 Service Manifest
3. consumer balance buckets
4. provider receivable buckets

所以系统不应该问：

“这个钱包当前处在哪种旧式角色心智里？”

而应该问：

1. 归属 owner 是谁
2. 当前动作是什么
3. 命中的 ledger bucket 是哪一个

## 9. 对账与审计模型

### 9.1 Ledger Entry

每次资金变化都必须形成 append-only entry，至少包含：

1. `owner_id`
2. `account_kind`
3. `event_type`
4. `delta_usdc`
5. `reference_id`
6. `created_at`

### 9.2 Audit Event

每次关键动作还必须形成审计事件，至少包含：

1. actor type
2. owner
3. action
4. status
5. request id / tx hash / invocation id
6. error code if failed

## 10. 平台 UI 与控制面的要求

前端和管理后台都要围绕相同模型：

1. Agent Workspace 读 consumer balance、budgets、usage
2. Provider Workspace 读 provider receivable、services、withdrawals
3. Admin / Finance 面板看全局 platform fee、reconciliation、alerts

禁止再把：

1. consumer balance
2. provider receivable
3. platform fee

混成一个模糊的“总余额”。

## 11. 数学不变量

至少要满足：

$$
\sum consumer\_available + \sum consumer\_pending + \sum consumer\_locked + \sum provider\_receivable + \sum provider\_locked + platform\_fee = vault\_obligation
$$

对每个 owner，还要能拆出 owner-scoped 视图：

$$
owner\_consumer\_exposure + owner\_provider\_receivable + owner\_provider\_locked = owner\_total\_offchain\_position
$$

## 12. 代码重构指引

后续代码重构时，应按这个方向推进：

1. 去掉旧双边角色作为主账务建模语言
2. 把 refund 和 provider withdrawal 的 bucket isolation 写进 storage 和 service 层
3. 把 invocation settlement 改成 ledger entry first
4. 让 `GET /balance` 返回 owner-scoped finance summary，而不是历史双角色心智模型

## 13. 最终结论

结算与扣费系统的 canonical 新设计是：

**一个 Owner 身份，多个 Agent Runtime，多个 Provider-side services，多资金桶账本，统一由 Platform 做报价、扣费、分账、审计和清算。**
