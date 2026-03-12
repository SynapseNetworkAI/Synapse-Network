# Synapse Network 文档总览

当前 `doc/` 已按“功能域”重新整理，便于按模块查阅与维护。

## 1. 功能设计 (`feature_designs/`)

### 1.1 架构与鉴权 (`feature_designs/architecture/`)
- [核心架构](feature_designs/architecture/%E6%A0%B8%E5%BF%83%E6%9E%B6%E6%9E%84.md)
- [Synchronous Payment And FastAPI Design](feature_designs/architecture/Synchronous-Payment-And-FastAPI-Design.md)
- [AI Service Discovery Architecture](feature_designs/architecture/AI_Service_Discovery_Architecture.md)
- [Wallet Integration Design](feature_designs/architecture/Wallet-Integration-Design.md)

### 1.2 Agent 能力与拓扑 (`feature_designs/agent/`)
- [Agent Credential / RateLimit / Audit Design](feature_designs/agent/Agent-Credential-RateLimit-Audit-Design.md)
- [Agent Friendly Service Registration Design](feature_designs/agent/Agent-Friendly-Service-Registration-Design.md)
- [Buyer Wallet Agent Topology Design](feature_designs/agent/Buyer-Wallet-Agent-Topology-Design.md)

### 1.3 网关与支付 (`feature_designs/gateway_payment/`)
- [Platform Gateway Deposit Credential Architecture Design](feature_designs/gateway_payment/Platform-Gateway-Deposit-Credential-Architecture-Design.md)
- [Platform Gateway V2 Data Model](feature_designs/gateway_payment/Platform-Gateway-V2-Data-Model.md)
- [Platform Gateway V2 Implementation Plan](feature_designs/gateway_payment/Platform-Gateway-V2-Implementation-Plan.md)
- [High Frequency MicroPayment V2 Design](feature_designs/gateway_payment/High-Frequency-MicroPayment-V2-Design.md)

### 1.4 结算与扣款 (`feature_designs/settlement_deduction/`)
- [Settlement Detailed Design](feature_designs/settlement_deduction/Settlement-Detailed-Design.md)
- [Deduction Detailed Design](feature_designs/settlement_deduction/Deduction-Detailed-Design.md)
- [结算核心](feature_designs/settlement_deduction/%E7%BB%93%E7%AE%97%E6%A0%B8%E5%BF%83.md)
- [扣款核心](feature_designs/settlement_deduction/%E6%89%A3%E6%AC%BE%E6%A0%B8%E5%BF%83.md)

### 1.5 前端与产品体验 (`feature_designs/frontend_product/`)
- [Frontend A2A Provider Mode](feature_designs/frontend_product/Frontend-A2A-Provider-Mode.md)
- [Dashboard Product Onboarding Design](feature_designs/frontend_product/Dashboard-Product-Onboarding-Design.md)
- [Unified Website Page Architecture Design](feature_designs/frontend_product/Unified-Website-Page-Architecture-Design.md)

### 1.6 规划与阶段目标 (`feature_designs/planning/`)
- [MVP](feature_designs/planning/MVP.md)

## 2. 运维与使用指南 (`operation_guides/`)

### 2.1 开发者指南 (`operation_guides/developer/`)
- [Python Dev Guide](operation_guides/developer/Python-Dev-Guide.md)
- [Local Otterscan Setup with Anvil](operation_guides/developer/Anvil-Otterscan-Setup.md)
- [Buyer SDK Quickstart](operation_guides/developer/Buyer-SDK-Quickstart.md)

### 2.2 用户使用指南 (`operation_guides/user/`)
- [Website Usage Guide Buyer Seller](operation_guides/user/Website-Usage-Guide-Buyer-Seller.md)
