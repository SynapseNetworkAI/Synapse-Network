# Synapse Network 后端补充说明

这个目录不再承担 canonical 协议定义职责。

当前 build-for-agent 的协议、凭据、Manifest、数据库主模型，统一以 `docs/agent/` 与 `docs/api.md` 为准；`04_Synapse_Network/` 只保留少量**实现补充说明**，用于解释 Gateway 内部落地、Provider 控制面映射和历史兼容边界。

## 1. 阅读原则

先读 canonical：

1. `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
2. `docs/agent/03_Service_Manifest_Field_Standard.md`
3. `docs/agent/04_Credential_Budget_Risk_Model.md`
4. `docs/api.md`

再回到本目录看补充：

- `API_Billing_Deduction_Protocol.md`：Gateway 在 HTTP 交付、预冻结、回滚、结算上的实现补充。
- `Service_Manifest_Registration.md`：Provider 注册输入如何映射到 canonical Manifest 与 Gateway 扩展字段。
- `Credential_and_RateLimit.md`：Provider Secret / Provider 控制面凭据的历史兼容说明。
- `买家费率动态计算.md`：平台费率策略和路由税的实现补充。

## 2. 目录约束

1. 本目录文档不能重新定义 Discovery / Quote / Invoke 主协议。
2. 本目录文档不能重新定义 Agent Credential / Budget 主模型。
3. 如果某个主题已经被吸收进 `docs/agent/`，这里最多保留落地映射和实现备注。
4. 纯历史草案、旧 SDK README、聊天式设计讨论，不再留在本目录，统一归档到 `docs/archive/`。