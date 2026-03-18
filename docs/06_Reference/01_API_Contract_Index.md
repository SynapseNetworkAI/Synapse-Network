# API Contract Index

## 1. 目标

本文件把 Synapse 对外 API 合约收敛成稳定的索引视图，方便实现者、SDK、前端和测试统一对齐。

## 2. 总体分类

### 2.1 Authentication APIs

包括：

1. challenge
2. verify
3. logout

它们负责建立 Owner session，而不是承载 Runtime 调用。

### 2.2 Owner Session Business APIs

包括：

1. balance
2. deposit attempts / intents
3. refund
4. providers withdrawals
5. router config
6. finance audit logs
7. admin fee policy
8. deposits replay
9. service control APIs

### 2.3 Public or Runtime APIs

包括：

1. services discover
2. network stats
3. services quote
4. gateway generate
5. indexer status

## 3. 统一身份语义

所有接口都应建立在同一套身份模型之上：

1. Owner 是 session 根身份
2. Agent Credential 是 Runtime 执行凭据
3. Provider 是 Owner 的供给侧业务角色
4. Platform 执行鉴权、路由、结算和审计

## 4. Finance 相关契约摘要

### 4.1 Balance Summary

余额摘要目标态至少应能表达：

1. `consumerAvailableBalance`
2. `consumerPendingBalance`
3. `consumerFrozenBalance`
4. `providerReceivableBalance`
5. `providerLockedBalance`
6. `platformFeeAccrued`

### 4.2 Deposit Intent

Deposit intent 的最低语义：

1. 要求幂等键
2. 要求唯一 `txHash`
3. 先进入待确认
4. 确认后再转可消费余额

### 4.3 Provider Withdrawal Intent

Provider withdrawal 的最低语义：

1. 只作用于 `provider_receivable`
2. 风控输出 `green / yellow / red`
3. `yellow` 进入人工审核
4. `red` 直接拒绝并审计

## 5. Runtime 契约摘要

### 5.1 Discover

Discover 接口只应暴露：

1. service
2. schema
3. price
4. health
5. routing contract

不应暴露 Provider 结算面。

### 5.2 Quote

Quote 至少要绑定：

1. credential
2. service
3. 价格
4. 有效期

### 5.3 Invoke

Invoke 前必须检查：

1. owner scope
2. credential
3. budget policy
4. quote 或 pricing policy
5. rate limit
6. balance sufficiency

Invoke 后必须完成：

1. capture 或 release
2. ledger
3. audit
4. 统一结果返回

## 6. 设计规则

所有实现都应遵守：

1. 文档优先表达目标态业务语义
2. Runtime 默认只暴露 service-facing 信息
3. 任何资金接口变更都必须同步更新 API 文档、测试和实现

## 7. 文档结论

API Index 的价值，不是重复贴接口路径，而是让所有人对 Synapse 的身份、资金桶、Runtime 契约和控制面边界有同一套理解。