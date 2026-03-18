# Synapse Network Backend Implementation Notes

本目录不再承担 canonical 协议定义职责。

当前 build-for-agent 的身份模型、Runtime 协议、Manifest 标准、Budget 模型和 API 合约，统一以：

1. `docs/agent/`
2. `docs/api.md`
3. `docs/Gateway_Database_Design.md`

为准。

`04_Synapse_Network/` 只保留 Gateway 和 Provider 控制面的**实现补充说明**与**历史兼容边界说明**。

## 1. 先读 canonical，再看本目录

先读：

1. `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
2. `docs/agent/03_Service_Manifest_Field_Standard.md`
3. `docs/agent/04_Credential_Budget_Risk_Model.md`
4. `docs/api.md`

再读本目录：

1. `API_Billing_Deduction_Protocol.md`
	Gateway 代理转发、HTTP 交付、预冻结、回滚、结算实现补充。
2. `Service_Manifest_Registration.md`
	Provider 注册输入如何映射到 canonical Manifest 与 Gateway 扩展字段。
3. `Credential_and_RateLimit.md`
	Provider Secret、Rate Limit、控制面兼容说明。
4. `平台费率动态计算.md`
	平台费率策略和路由税的实现补充。

## 2. 本目录适合回答的问题

1. Gateway 是怎么把 canonical 协议落到 Python / FastAPI / Postgres 的。
2. Provider 注册服务时，哪些字段是 canonical，哪些是 Gateway 扩展字段。
3. Gateway 内部的扣费、回滚、费率策略、Provider 控制面如何实现。

## 3. 迁移说明索引

本目录里的以下文档继续保留，但都已经降级为实现补充层，不再承担 canonical 定义职责：

1. `API_Billing_Deduction_Protocol.md`
	canonical 替代：`docs/agent/02_Discovery_Quote_Invoke_API_Design.md`、`docs/api.md`、`docs/agent/04_Credential_Budget_Risk_Model.md`、`docs/03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md`
2. `Service_Manifest_Registration.md`
	canonical 替代：`docs/agent/03_Service_Manifest_Field_Standard.md`、`docs/api.md`
3. `Credential_and_RateLimit.md`
	canonical 替代：`docs/agent/04_Credential_Budget_Risk_Model.md`、`docs/agent/06_Build_For_Agent_Database_Rebuild.md`、`docs/api.md`
4. `平台费率动态计算.md`
	canonical 替代：`docs/api.md`、`docs/03_Smart_Contract_Payment/Settlement_and_Deduction_Logic.md`、`docs/Gateway_Database_Design.md`

## 4. 目录约束

1. 本目录不能重新定义 Discovery / Quote / Invoke 主协议。
2. 本目录不能重新定义 Agent Credential / Budget 主模型。
3. 如果某主题已经被吸收到 `docs/agent/`，这里最多保留实现映射和历史兼容备注。
4. 本目录默认是“后端实现补充层”，不是新的产品总设计入口。