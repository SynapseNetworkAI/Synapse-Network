# Synapse Gateway Financial Risk Control Design

## 1. 文档目标

本设计把 Synapse 的资金链路收敛成一套完整的 build-for-agent 风控模型，覆盖：

1. Owner 入金
2. Agent 消费与结算
3. 消费侧退款
4. Owner 作为 Provider 角色时的收益提现
5. 流动性保护、人工审核、告警处置

## 2. 总体设计原则

1. 入金可以快，但出金必须审。
2. 预算与结算分离，风控与清算分层。
3. 资金一致性优先于处理时延。
4. 风控决策必须可解释、可复核、可审计。

## 3. 统一资金状态模型

### 3.1 资金桶

1. `consumer_available`
2. `consumer_pending`
3. `consumer_frozen`
4. `provider_receivable`
5. `provider_locked`
6. `platform_fee`

### 3.2 风险等级

1. `green`
2. `yellow`
3. `red`

### 3.3 关键状态机

#### Deposit

1. `PENDING_CONFIRMATION`
2. `CONFIRMED`
3. `REORG_SUSPECT`
4. `FROZEN_RISK`

#### Refund

1. `REQUESTED`
2. `PENDING_MANUAL_REVIEW`
3. `APPROVED`
4. `REJECTED`
5. `COMPLETED`

#### Provider Withdrawal

1. `REQUESTED`
2. `APPROVED_AUTO`
3. `PENDING_MANUAL_REVIEW`
4. `SIGNED`
5. `ONCHAIN_SUBMITTED`
6. `CONFIRMED`
7. `REJECTED`

## 4. 风控主流程

### 4.1 Owner 入金风控

目标：体验优先，但不能牺牲幂等、确认分层、可疑资金冻结能力。

控制要求：

1. `tx_hash` 全局唯一。
2. 零值、负值、地址不匹配直接拒绝。
3. 高风险来源地址允许进入观察态，不允许立刻转为可消费或可出金。
4. 对账必须持续验证 `vault obligation == consumer_available + consumer_pending + provider obligations + platform obligations`。

### 4.2 Agent 消费风控

目标：允许高频调用，但阻断超扣、预算穿透、异常爆刷。

控制要求：

1. credential、budget、rate limit、service policy 四层前置。
2. 调用前预占或确认价格上限。
3. 调用成功后 capture；失败后 release。
4. 高频异常组合触发限流、熔断与审计告警。

### 4.3 消费侧退款风控

目标：支持可解释退款，但防止超退、拆单套利、地址改道。

控制要求：

1. 必须绑定原始 invocation / origin tx / request_id。
2. 退款上限不得超过剩余可退余额。
3. 同一来源在短窗口内的异常拆分请求提升为高风险。
4. 大额退款进入人工审核。

### 4.4 Owner 作为 Provider 的提现风控

目标：保证同一个 Owner 在供给侧赚钱后，可以提现，但提现必须经过更强风控。

提现前统一校验：

1. `provider_receivable` 是否充足。
2. 单笔金额与 24h 累计金额是否越线。
3. 账户年龄是否达到保护期。
4. 历史净收入与本次申请金额是否匹配。
5. 地址、设备、IP、行为突变是否命中高风险标签。
6. 平台流动性是否允许当前等级的自动出金。

风险分流：

1. `green`
   - `provider_receivable -> pending release`
   - 自动签发 EIP-712 或等价出金票据
2. `yellow`
   - `provider_receivable -> provider_locked`
   - 人工审核后决定通过或拒绝
3. `red`
   - 直接拒绝
   - 记录风控理由
   - 触发告警与观察期

## 5. 流动性风控

定义：

`Liquidity Ratio = Vault Available / Expected 24h Net Outflow`

阈值建议：

1. `green`: `ratio >= 1.5`
2. `yellow`: `1.1 <= ratio < 1.5`
3. `red`: `ratio < 1.1`

联动规则：

1. 流动性降级时，下调自动提现阈值。
2. 命中红线时，自动提现关闭，全部进入人工审核。
3. 平台必须在 Admin 面板和告警通道中暴露当前流动性等级。

## 6. 人工审核设计

人工审核不是补丁，而是正式流程节点。

审核步骤：

1. 查看 owner 基础画像、账户年龄、历史净收入。
2. 查看近 24h / 7d 行为变化。
3. 查看提现地址、设备、IP 风险标签。
4. 查看关联服务是否有真实交付和真实收入沉淀。
5. 给出 `approve / reject / continue_hold` 决策。
6. 追加 reviewer metadata 与 evidence 摘要。

## 7. 告警与运维联动

P1 告警：

1. 红灯提现请求
2. 流动性红线
3. 大规模 replay / idempotency mismatch
4. 对账 delta 超阈值

P2 告警：

1. 黄色审核积压
2. 高频失败或异常拆分退款
3. Provider 收益与实际交付明显失配

## 8. KPI

1. Agent 首次自主付费调用成功率
2. 自动放行提现占比
3. 审核通过率
4. 误杀率
5. 漏拦率
6. 对账差异率
7. 人工审核平均处理时长

## 9. 结论

Synapse 的风控不应按“调用方 / 服务方”两套割裂模型设计，而应围绕 `同一个 Owner 可以既消费又供给` 的事实来设计。真正需要被严格隔离的不是身份名词，而是资金桶、业务动作、风控等级和出金权限。
