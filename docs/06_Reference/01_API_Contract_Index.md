# API Contract Index

## 1. 目标

本文件把 Synapse 对外 API 合约收敛成稳定的索引视图，方便实现者、SDK、前端和测试统一对齐。

它不重复维护所有字段细节，而是回答 4 个问题：

1. 哪一层系统拥有哪类 API 合约。
2. 当前应该读哪份 canonical 文档。
3. gateway、gateway-admin、provider runtime 的边界怎么切。
4. 当契约变更时，最少要同步哪些文档。

## 2. Canonical Source Map

### 2.1 Gateway Runtime And Owner APIs

主真理源：

1. [05_Runtime_API_Contract.md](./05_Runtime_API_Contract.md)
2. [06_Runtime_Error_Code_Catalog.md](./06_Runtime_Error_Code_Catalog.md)
3. [../03_Core_Workflows/02_Discovery_and_Gateway_Call.md](../03_Core_Workflows/02_Discovery_and_Gateway_Call.md)
4. [../02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md](../02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md)
5. [../03_Projects/gateway/README.md](../03_Projects/gateway/README.md)

适用范围：

1. `gateway` 对外暴露的 Auth、Owner Session、Discover、Quote、Invoke、Balance、Deposit、Refund、Provider Withdraw 等接口
2. SDK、前端和测试对 runtime 主链路的对齐

### 2.2 Admin Control-Plane APIs

主真理源：

1. [../admin/Admin_API_Contract_Phase1.md](../admin/Admin_API_Contract_Phase1.md)
2. [../admin/Platform_Admin_Backoffice_Architecture.md](../admin/Platform_Admin_Backoffice_Architecture.md)
3. [../03_Projects/gateway-admin/README.md](../03_Projects/gateway-admin/README.md)
4. [../03_Projects/admin-front/README.md](../03_Projects/admin-front/README.md)

适用范围：

1. `gateway-admin` 暴露给 `admin-front` 的后台控制面接口
2. 管理员认证、CSRF、step-up、审批、Dashboard、菜单配置与提现审核等高风险运营面

### 2.3 Provider Runtime Sample APIs

主真理源：

1. [../provider_service/api/README.md](../provider_service/api/README.md)
2. [../provider_service/contracts/SERVICE_DRAFTS.md](../provider_service/contracts/SERVICE_DRAFTS.md)
3. [../03_Projects/provider-service/README.md](../03_Projects/provider-service/README.md)

适用范围：

1. `provider_service` 作为 provider runtime sample 的独立服务接口
2. 首批样板服务的 `POST /invoke` 与 `GET /health` 统一骨架

## 3. Contract Ownership Boundaries

### 3.1 gateway

`gateway` 拥有：

1. Agent-facing runtime contract
2. Owner session business contract
3. 资金桶、余额、扣费、收据、审计相关外部语义

`gateway` 不拥有：

1. 管理员控制面浏览器接口
2. provider runtime 自身的服务内请求/响应模型

### 3.2 gateway-admin

`gateway-admin` 拥有：

1. `admin-front -> gateway-admin` 控制面 API 合约
2. 管理员 session、CSRF、step-up、审批、配置发布与人工审核语义

`gateway-admin` 不拥有：

1. Agent-facing discover / quote / invoke 合约
2. Owner-facing 高频资金主链路合约

### 3.3 provider_service

`provider_service` 拥有：

1. provider runtime sample 的服务级输入输出骨架
2. 独立 provider API 的结果结构、freshness、sources、errors 语义

`provider_service` 不拥有：

1. 平台扣费、预算、账本、提现审批语义
2. 服务注册控制面 contract

## 4. 总体分类

### 4.1 Authentication APIs

当前 canonical 入口：

1. [05_Runtime_API_Contract.md](./05_Runtime_API_Contract.md)
2. [../admin/Admin_API_Contract_Phase1.md](../admin/Admin_API_Contract_Phase1.md)

包括：

1. Owner challenge / verify / logout
2. Admin login / me / logout / policy

它们负责建立 Session，不直接承载 Runtime invoke。

### 4.2 Owner Session Business APIs

当前 canonical 入口：

1. [05_Runtime_API_Contract.md](./05_Runtime_API_Contract.md)
2. [../03_Core_Workflows/01_Deposit_and_Idempotency.md](../03_Core_Workflows/01_Deposit_and_Idempotency.md)
3. [../03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md](../03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md)

包括：

1. balance
2. deposit attempts / intents / sync
3. refund
4. provider withdrawals
5. router config
6. finance audit logs
7. usage logs
8. service control APIs

### 4.3 Public or Runtime APIs

当前 canonical 入口：

1. [05_Runtime_API_Contract.md](./05_Runtime_API_Contract.md)
2. [../03_Core_Workflows/02_Discovery_and_Gateway_Call.md](../03_Core_Workflows/02_Discovery_and_Gateway_Call.md)
3. [03_Service_Manifest_and_Runtime_Object_Reference.md](./03_Service_Manifest_and_Runtime_Object_Reference.md)

包括：

1. services discover
2. network stats
3. services quote
4. gateway generate
5. indexer status

### 4.4 Admin Control-Plane APIs

当前 canonical 入口：

1. [../admin/Admin_API_Contract_Phase1.md](../admin/Admin_API_Contract_Phase1.md)
2. [../admin/Admin_Approval_Workflow.md](../admin/Admin_Approval_Workflow.md)

包括：

1. admin auth
2. dashboard
3. approval queues and decisions
4. withdrawal review decisions
5. execution jobs and menu publish controls

### 4.5 Provider Service APIs

当前 canonical 入口：

1. [../provider_service/api/README.md](../provider_service/api/README.md)
2. [../provider_service/api/web3_sentiment_api/web3-sentiment-index.md](../provider_service/api/web3_sentiment_api/web3-sentiment-index.md)

包括：

1. provider health
2. provider invoke endpoints
3. service-specific `service / sources / freshness / result / errors` 返回骨架

## 5. 统一身份语义

所有接口都应建立在同一套身份模型之上：

1. Owner 是 session 根身份
2. Agent Credential 是 Runtime 执行凭据
3. Provider 是 Owner 的供给侧业务角色
4. Platform 执行鉴权、路由、结算和审计

## 6. Finance 相关契约摘要

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
5. replay 命中时返回已有 intent，不把重复提交暴露成 409 冲突

### 4.3 Provider Withdrawal Intent

Provider withdrawal 的最低语义：

1. 只作用于 `provider_receivable`
2. 风控输出 `green / yellow / red`
3. `yellow` 进入人工审核
4. `red` 直接拒绝并审计

## 7. Runtime 契约摘要

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

## 8. Contract Sync Rule

当 API 契约变更时，至少要同步以下层次：

1. `gateway` Owner / Runtime 主链路：更新 [05_Runtime_API_Contract.md](./05_Runtime_API_Contract.md)
2. 管理后台控制面：更新 [../admin/Admin_API_Contract_Phase1.md](../admin/Admin_API_Contract_Phase1.md)
3. provider sample 服务：更新 `docs/provider_service/api/*.md`
4. 如果返回结构或错误码变化，更新 [06_Runtime_Error_Code_Catalog.md](./06_Runtime_Error_Code_Catalog.md) 与相关测试

## 9. 设计规则

所有实现都应遵守：

1. 文档优先表达目标态业务语义
2. Runtime 默认只暴露 service-facing 信息
3. 任何资金接口变更都必须同步更新 API 文档、测试和实现

## 10. 文档结论

API Index 的价值，不是重复贴接口路径，而是把 gateway runtime、admin control plane、provider runtime sample 三层契约的真理源和边界一次说清，让实现者知道应该改哪份文档、在哪一层对齐测试与集成。
