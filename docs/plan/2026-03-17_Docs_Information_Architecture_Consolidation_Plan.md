# Docs 信息架构收敛计划

日期：2026-03-17

## 1. 目标

把 `docs/` 从“历史设计堆积目录”收敛成一套围绕 build-for-agent 主线的可维护知识库。

本次收敛目标：

1. 明确当前 canonical 文档集合。
2. 让文档按功能分类可读：业务核心、后端、数据库、前端、运维、管理后台。
3. 把明显过时的旧角色词 / wallet / V2 过渡期方案移出主阅读路径。
4. 为后续继续合并重复文档留下稳定规则。

## 2. 设计判断标准

保留文档必须满足至少一个条件：

1. 它定义了当前 build-for-agent 产品边界、对象模型或协议。
2. 它解释了当前数据库、账本、充值提现、清算或运维的真实实现。
3. 它为前端、后端、数据库、后台运营提供当前仍然有效的执行指导。

应归档或删除的文档：

1. 继续使用历史消费侧 / Wallet / API Key 旧主模型定义系统核心对象。
2. 与 `docs/agent/*` 中的 canonical 设计直接重复。
3. 描述的是 V2 过渡期 schema 或已被新 Runtime 架构替代的旧总览。

## 3. 当前 canonical 文档集合

### 业务核心
- `docs/agent.md`
- `docs/01_Product_Vision/Design.md`
- `docs/agent/01_Agent_Runtime_Product_Architecture.md`
- `docs/agent/05_Dashboard_IA_and_Onboarding.md`

### 后端与协议
- `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
- `docs/agent/03_Service_Manifest_Field_Standard.md`
- `docs/agent/04_Credential_Budget_Risk_Model.md`
- `docs/api.md`
- `docs/02_Architecture/High_Frequency_MicroPayment_V2.md`
- `docs/02_Architecture/Financial_Production_Security.md`
- `docs/02_Architecture/Gateway_Financial_Risk_Control_Design.md`

### 数据库与资金真相层
- `docs/agent/06_Build_For_Agent_Database_Rebuild.md`
- `docs/03_Smart_Contract_Payment/Agent_Runtime_Data_Model.md`
- `docs/Gateway_Database_Design.md`
- `infra/docker/postgres/init/001_synapse_schema.sql`

### 前端
- `docs/05_Frontend_UX/*`
- `docs/feature_designs/frontend_product/*`

### 运维
- `docs/06_Developer_Guides/*`
- `docs/02_Architecture/GitHub_Workflows_CICD_and_Production_Operations.md`
- `docs/02_Architecture/Financial_Security_Incident_Runbook.md`
- `docs/02_Architecture/Phase5_Liquidity_Alert_SOP_Implementation.md`

### 管理后台
- `docs/admin/*`
- `docs/feature_designs/backend_admin/*`

## 4. 本轮已执行的收敛动作

### 4.1 已归档文档

归档到 `docs/archive/pre_agent/`：

- `wallet.md`
- `soul.md`
- `04_Synapse_Network/AI_Service_Discovery.md`
- `04_Synapse_Network/legacy_consumer_discovery_sdk.md`
- `04_Synapse_Network/legacy_consumer_wallet_topology.md`
- `04_Synapse_Network/Credential_Design_Optimization.md`
- `04_Synapse_Network/Synapse_Client_README.md`

归档到 `docs/archive/historical_schema/`：

- `03_Smart_Contract_Payment/Gateway_V2_Data_Model.md`
- `03_Smart_Contract_Payment/Gateway_V2_Plan.md`

归档到 `docs/archive/historical_architecture/`：

- `02_Architecture/Core_Architecture.md`
- `02_Architecture/Storage_Strategy_Upgrade.md`

### 4.2 已更新文档入口

- 重写了 `docs/README.md`，现在它明确了：
	- canonical 文档集合
	- 业务域分类
	- 归档文档策略
	- 新文档维护规则

### 4.3 已完成的 `04_Synapse_Network/` 收敛

- `Service_Manifest_Registration.md` 中仍有价值的 Provider 注册映射 / Gateway 扩展字段，已并入 `docs/agent/03_Service_Manifest_Field_Standard.md`。
- `API_Billing_Deduction_Protocol.md`、`Credential_and_RateLimit.md`、`平台费率动态计算.md` 已降级为实现补充说明，不再定义 canonical 协议。
- `04_Synapse_Network/README.md` 已新增，明确本目录只保留补充说明和历史兼容备注。

## 5. 当前目录分类规则

### 业务核心
- `01_Product_Vision/`
- `agent/`
- `agent.md`

### 后端
- `02_Architecture/`
- `04_Synapse_Network/`
- `api.md`
- `Gateway_Error_Codes.md`

### 数据库
- `03_Smart_Contract_Payment/`
- `Gateway_Database_Design.md`

### 前端
- `05_Frontend_UX/`
- `feature_designs/frontend_product/`

### 运维
- `06_Developer_Guides/`
- `02_Architecture/` 中的部署、应急、SOP 类文档

### 管理后台
- `admin/`
- `feature_designs/backend_admin/`

### 历史文档
- `archive/`

## 6. 下一轮继续收敛的任务

### 高优先级
1. 为 `03_Smart_Contract_Payment/Owner_Vault_Deposit_End_to_End_Dataflow.md` 做术语升级，把 Owner / Agent / Vault 边界写清楚。
2. 继续检查 `04_Synapse_Network/` 是否还有纯历史残留需要归档，避免补充说明重新长成第二套协议。

### 中优先级
1. 为前端新增一份 build-for-agent 的 Runtime Playground / Discovery / Quote / Invoke IA 文档。
2. 给数据库和 schema 补一份“文档与 SQL 一致性检查”说明。
3. 给 `docs/admin/` 和 `06_Developer_Guides/` 增加各自 README，降低查找成本。

### 低优先级
1. 继续清理中文 / 英文命名不统一的问题。
2. 为 `archive/` 下每一批历史文档补迁移说明，注明被什么 canonical 文档替代。

## 7. 执行规则

1. 新设计优先写入现有业务域，不再向根目录散落新文件。
2. 如果一个主题在 `agent/` 已经有 canonical 文档，其他目录不允许再新建一份并列协议定义。
3. 删除文档前先确认是否需要保留历史脉络；可追溯价值高的统一归档，不直接物理删除。
4. 任何涉及 API、数据库、前端 IA 变更的文档更新，都必须与代码事实一致。

## 8. 成功标准

完成本轮和下一轮收敛后，团队应能做到：

1. 新人 5 分钟内知道从哪里读当前有效设计。
2. 前端、后端、数据库、运维、后台团队各自能快速定位自己的文档域。
3. 历史方案不再污染 build-for-agent 的当前决策面。
4. 文档结构本身服务“Agent completed first paid invocation autonomously”这个最终目标。
