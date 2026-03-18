# Product and Frontend Design

本目录定义 Synapse 的产品定位、控制台信息架构和前端在系统中的真实职责。

这里不重复定义协议和数据库，只回答三个问题：

1. 产品到底服务谁
2. Owner、Agent、Provider、Platform 在前端上应该如何被正确呈现
3. Gateway Console 和 Admin Control Plane 应该怎样分层，才能服务 Agent-first 主线

## 真理源

本目录的约束来源：

1. `docs/agent.md`
2. `docs/Design.md`
3. `docs/agent/00_Platform_Role_Identity_Model.md`
4. `docs/agent/01_Agent_Runtime_Product_Architecture.md`
5. `docs/agent/05_Dashboard_IA_and_Onboarding.md`

## 阅读顺序

1. `01_Product_Positioning_and_Role_Model.md`
2. `02_Gateway_Console_Information_Architecture.md`
3. `03_Admin_Control_Plane_Architecture.md`
4. `04_Frontend_Design_System_Application.md`

## 模块边界

本目录不承担：

1. API 合约全集：看 `docs/api.md`
2. Runtime 主流程：看 `docs/03_Core_Workflows/`
3. SQL 表结构和锁策略：看 `docs/04_Database_Design/`
4. 后端实现细节：看 `docs/02_System_Architecture/`

## 核心结论

Synapse 的前端不是给人手工刷接口的传统控制台，而是：

1. 给 Owner 做授权、观测、止损和运营
2. 给 Provider 做服务注册、收益查看和提现控制
3. 给 Admin 做风险、审批、对账和治理
4. 始终围绕 “Agent completed first paid invocation autonomously” 这个北极星组织信息