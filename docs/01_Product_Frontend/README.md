# Product and Frontend Design

- Status: canonical
- Code paths: `apps/frontend/src/`, `admin/admin-front/src/`
- Supersedes: former `docs/agent/05_Dashboard_IA_and_Onboarding.md` for owner console responsibilities and activation loop
- Last verified against code: 2026-03-24

本目录定义 Synapse 的产品定位、控制台信息架构和前端在系统中的真实职责。

当前 Owner Console 的高层 IA、Dashboard 职责和首次激活路径，已经收口到本目录。former `docs/agent/05_Dashboard_IA_and_Onboarding.md` 已完成退役，不再单独定义长期前台真相。

这里不重复定义协议和数据库，只回答三个问题：

1. 产品到底服务谁
2. Owner、Agent、Provider、Platform 在前端上应该如何被正确呈现
3. Gateway Console 和 Admin Control Plane 应该怎样分层，才能服务 Agent-first 主线

## 真理源

本目录的约束来源：

1. `docs/AGENTS.md`
2. `docs/Design.md`
3. `docs/01_Product_Frontend/01_Product_Positioning_and_Role_Model.md`
4. `docs/02_System_Architecture/README.md`
5. `docs/03_Core_Workflows/README.md`

## 阅读顺序

1. `01_Product_Positioning_and_Role_Model.md`
2. `02_Gateway_Console_Information_Architecture.md`
3. `03_Admin_Control_Plane_Architecture.md`
4. `04_Frontend_Design_System_Application.md`

## 迁移说明

`docs/01_Product_Frontend/AGENTS.md` 已正式退役，不再作为 Agents 页的设计真理源。

当前唯一有效的 Agents 页面说明迁移到：

1. `docs/01_Product_Frontend/owner_agent_guide/agents_guide.md`

清理原则：

1. 历史上未继续采用的 Agents 旧方案直接删除，不保留并行设计入口
2. 后续 Agents 页面改动只更新 owner guide，不再恢复旧 `AGENTS.md`
3. 充值能力与 Owner Treasury 使用同一套 Vault Deposit 流程；旧 `/dashboard/console` 仅保留为跳转到 `/dashboard/developer` 的兼容入口，避免重新出现混合控制台

## Owner Console 边界

Dashboard 不是交易主战场，它是 Owner 的控制台。

它的职责只有四个：

1. 让 Owner 快速完成启动配置
2. 让 Owner 快速知道 Agent 是否在赚钱或烧钱
3. 让 Owner 快速发现风险并止损
4. 让 Owner 快速拿到 SDK、Credential 和示例

## First Activation Loop

Owner 的首次激活路径必须压缩成五步：

1. Connect Wallet
2. Deposit USDC
3. Create Agent
4. Issue Credential + Set Budget
5. Run First Paid Invocation

第五步必须是 onboarding 的终点；否则只是完成开户，没有完成激活。

## 模块边界

本目录不承担：

1. API 合约全集：看 `docs/06_Reference/05_Runtime_API_Contract.md`
2. Runtime 主流程：看 `docs/03_Core_Workflows/`
3. SQL 表结构和锁策略：看 `docs/04_Database_Design/`
4. 后端实现细节：看 `docs/02_System_Architecture/`

## 核心结论

Synapse 的前端不是给人手工刷接口的传统控制台，而是：

1. 给 Owner 做授权、观测、止损和运营
2. 给 Provider 做服务注册、收益查看和提现控制
3. 给 Admin 做风险、审批、对账和治理
4. 始终围绕 “Agent completed first paid invocation autonomously” 这个北极星组织信息