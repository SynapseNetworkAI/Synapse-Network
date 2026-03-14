# Synapse Network 文档总览

该目录经过重新整理，用于存放 `Synapse Network` 项目的核心架构设计、产品规划、智能合约与网关细节以及相关的开发者指南。我们根据功能的业务域（Domain）进行了规范化重构：

## 1. 产品愿景与商业设计 (`01_Product_Vision/`)
该模块记录了平台的核心概念、解决的痛点、如何盈利以及团队的长期战略：
- **产品核心思想**: [Product_Thinking.md](./01_Product_Vision/Product_Thinking.md)
- **商业计划书**: [Business_Plan.md](./01_Product_Vision/Business_Plan.md)
- **收费与商业模式**: [Monetization_Model.md](./01_Product_Vision/Monetization_Model.md)
- **投资与路演资料**: [Pitch_Deck_Material.md](./01_Product_Vision/Pitch_Deck_Material.md)
- **项目路线图**: [ROADMAP.md](./01_Product_Vision/ROADMAP.md) / [MVP.md](./01_Product_Vision/MVP.md)

## 2. 核心架构设计 (`02_Architecture/`)
该模块涵盖了系统宏观运转机制，平台级别的基础选型：
- **A2A 全局核心架构**: [Core_Architecture.md](./02_Architecture/Core_Architecture.md)
- **高频微支付终极架构 (高并发下 0 Gas)**: [High_Frequency_MicroPayment_V2.md](./02_Architecture/High_Frequency_MicroPayment_V2.md)
- **FastAPI 网关同步支付设计**: [FastAPI_Synchronous_Payment.md](./02_Architecture/FastAPI_Synchronous_Payment.md)
- **AI 反向代理与路由**: [API_Gateway_Reverse_Proxy.md](./02_Architecture/API_Gateway_Reverse_Proxy.md)
- **网关日志追踪系统**: [Gateway_Application_Logging.md](./02_Architecture/Gateway_Application_Logging.md)
- **资金生产安全基线**: [Financial_Production_Security.md](./02_Architecture/Financial_Production_Security.md)
- **存储方案升级（Demo -> Production）**: [Storage_Strategy_Upgrade.md](./02_Architecture/Storage_Strategy_Upgrade.md)
- **生产升级 TODO（存储与资金安全）**: [Production_Upgrade_TODO.md](./02_Architecture/Production_Upgrade_TODO.md)
- **生产升级 Issue 草案（可直接开单）**: [Production_Upgrade_Issue_Seeds.md](./02_Architecture/Production_Upgrade_Issue_Seeds.md)

## 3. 智能合约与支付结算 (`03_Smart_Contract_Payment/`)
所有围绕以太坊与 USDC 构建的金库、账本与对账体系：
- **链下计费与中心化账本设计**: [Offchain_Billing.md](./03_Smart_Contract_Payment/Offchain_Billing.md)
- **金库与一键充值 (Permit机制)**: [Vault_Deposit_Architecture.md](./03_Smart_Contract_Payment/Vault_Deposit_Architecture.md)
- **后端数据库 V2 数据模型**: [Gateway_V2_Data_Model.md](./03_Smart_Contract_Payment/Gateway_V2_Data_Model.md)
- **卖家结算与平台抽水闭环**: [Settlement_and_Deduction_Logic.md](./03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md)
- **退款流程体系**: [Buyer_Refund_Process.md](./03_Smart_Contract_Payment/Buyer_Refund_Process.md)

## 4. Agent 网络与协议 (`04_Agent_Network/`)
如何让两台互不认识的 AI 能够自主沟通、互相发现并完成 USDC 计价的交易：
- **Agent API 异常与计费协议**: [API_Billing_Deduction_Protocol.md](./04_Agent_Network/API_Billing_Deduction_Protocol.md)
- **零代码语义级服务发现系统**: [AI_Service_Discovery.md](./04_Agent_Network/AI_Service_Discovery.md)
- **买家钱包与 Agent 的子拓扑**: [Buyer_Wallet_Topology.md](./04_Agent_Network/Buyer_Wallet_Topology.md)
- **卖家服务挂载 (Service Manifest) 设计**: [Service_Manifest_Registration.md](./04_Agent_Network/Service_Manifest_Registration.md)  
- **调用凭据授权控制 (API Key)**: [Credential_and_RateLimit.md](./04_Agent_Network/Credential_and_RateLimit.md)

## 5. 前端产品设计 (`05_Frontend_UX/`)
关于网站页面构建、Next.js 状态隔离以及 UX 用户体验打磨：
- **统一 DashBoard 与入驻引导**: [Dashboard_Onboarding.md](./05_Frontend_UX/Dashboard_Onboarding.md)
- **前后端页面统一架构**: [Unified_Page_Architecture.md](./05_Frontend_UX/Unified_Page_Architecture.md)
- **充提资金流优化**: [Deposit_Flow_Optimization.md](./05_Frontend_UX/Deposit_Flow_Optimization.md)
- **卖家 Workspace 设置**: [Seller_Workspace.md](./05_Frontend_UX/Seller_Workspace.md)

## 6. 使用与开发者指南 (`06_Developer_Guides/`)
方便二次开发甚至快速 Demo 跑通的操作手册：
- **后端 Python 网关启动指南 (Dev)**: [Backend_Python_Dev_Guide.md](./06_Developer_Guides/Backend_Python_Dev_Guide.md)
- **后端单元测试与压测指南**: [Backend_Unit_Testing_Guide.md](./06_Developer_Guides/Backend_Unit_Testing_Guide.md)
- **买家 Python SDK 示例**: [Buyer_SDK_Quickstart.md](./06_Developer_Guides/Buyer_SDK_Quickstart.md)
- **前端 Web 综合使用手册**: [Website_User_Guide.md](./06_Developer_Guides/Website_User_Guide.md)
- **本地节点与区块链浏览器的搭建**: [Local_Blockchain_Setup.md](./06_Developer_Guides/Local_Blockchain_Setup.md)
- **资金安全应急处置手册**: [Financial_Security_Incident_Runbook.md](./06_Developer_Guides/Financial_Security_Incident_Runbook.md)

---
> “打造人类历史上第一个零摩擦的纯硅基服务结算网络。” —— **Synapse Network** 
