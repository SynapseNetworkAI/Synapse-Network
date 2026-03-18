# Docs 信息架构收敛计划

日期：2026-03-17

> 状态更新：Phase 1 至 Phase 5 已完成。旧 `02_Architecture/`、`03_Smart_Contract_Payment/`、`04_Synapse_Network/`、`05_Frontend_UX/`、`06_Developer_Guides/` 技术目录已退役，官方主阅读路径已切换到 `01_Product_Frontend/` 至 `06_Reference/` 六模块。

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
- `docs/Design.md`
- `docs/agent/01_Agent_Runtime_Product_Architecture.md`
- `docs/agent/05_Dashboard_IA_and_Onboarding.md`

### 后端与协议
- `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
- `docs/agent/03_Service_Manifest_Field_Standard.md`
- `docs/agent/04_Credential_Budget_Risk_Model.md`
- `docs/api.md`
- `docs/02_System_Architecture/`

### 数据库与资金真相层
- `docs/agent/06_Build_For_Agent_Database_Rebuild.md`
- `docs/04_Database_Design/`
- `docs/Gateway_Database_Design.md`
- `infra/docker/postgres/init/001_synapse_schema.sql`

### 前端
- `docs/01_Product_Frontend/`
- `docs/feature_designs/frontend_product/*`

### 运维
- `docs/05_DevOps_Deployment/`

### 管理后台
- `docs/admin/*`
- `docs/feature_designs/backend_admin/*`

## 4. 本轮已执行的收敛动作

### 4.1 已移出主阅读路径的历史主题

以下文档或主题已被判定为历史语义，不再出现在当前 canonical 入口和主 README 阅读路径中：

- `wallet.md`
- `soul.md`
- `04_Synapse_Network/AI_Service_Discovery.md`
- `04_Synapse_Network/legacy_consumer_discovery_sdk.md`
- `04_Synapse_Network/legacy_consumer_wallet_topology.md`
- `04_Synapse_Network/Credential_Design_Optimization.md`
- `04_Synapse_Network/Synapse_Client_README.md`
- `03_Smart_Contract_Payment/Gateway_V2_Data_Model.md`
- `03_Smart_Contract_Payment/Gateway_V2_Plan.md`
- `02_Architecture/Core_Architecture.md`
- `02_Architecture/Storage_Strategy_Upgrade.md`

说明：当前仓库不再使用独立归档目录作为主维护结构。这些历史主题的收敛方式，是通过 `docs/README.md` 和各子目录 `README.md` 将其移出主导航，并把当前 canonical 文档重新指向 `docs/agent/`、`docs/api.md`、`docs/Design.md` 与数据库/资金文档。

### 4.2 已更新文档入口

- 重写了 `docs/README.md`，现在它明确了：
	- canonical 文档集合
	- 业务域分类
	- 历史主题移出主阅读路径的策略
	- 新文档维护规则

### 4.3 已完成的旧目录退役

- `02_Architecture/` 的当前有效内容已并入 `docs/02_System_Architecture/` 与 `docs/05_DevOps_Deployment/`。
- `03_Smart_Contract_Payment/` 的当前有效内容已并入 `docs/03_Core_Workflows/` 与 `docs/04_Database_Design/`。
- `04_Synapse_Network/` 的当前有效内容已并入 `docs/02_System_Architecture/`、`docs/03_Core_Workflows/` 与 `docs/06_Reference/`。
- `05_Frontend_UX/` 的当前有效内容已并入 `docs/01_Product_Frontend/`。
- `06_Developer_Guides/` 的当前有效内容已并入 `docs/05_DevOps_Deployment/` 与 `docs/06_Reference/`。

## 5. 当前目录分类规则

### 业务核心
- `01_Product_Vision/`
- `agent/`
- `agent.md`

### 后端
- `02_System_Architecture/`
- `06_Reference/`
- `api.md`
- `Gateway_Error_Codes.md`

### 数据库
- `04_Database_Design/`
- `Gateway_Database_Design.md`

### 前端
- `01_Product_Frontend/`
- `feature_designs/frontend_product/`

### 运维
- `05_DevOps_Deployment/`

### 管理后台
- `admin/`
- `feature_designs/backend_admin/`

### 历史文档
- `docs/plan/` 中的收敛计划与迁移说明
- 各业务目录 README 中标注为 historical / compatibility 的文档

## 6. 下一轮继续收敛的任务

### 高优先级
1. 继续校验根级真理源与六个官方模块之间的链接一致性。
2. 为后续代码演进建立 docs-code-test 三方同步检查清单。

### 中优先级
1. 为前端新增一份 build-for-agent 的 Runtime Playground / Discovery / Quote / Invoke IA 文档。
2. 给数据库和 schema 补一份“文档与 SQL 一致性检查”说明。
3. 继续补齐仍缺失目录的 README 或主题索引，降低查找成本。

### 低优先级
1. 继续清理中文 / 英文命名不统一的问题。
2. 为仍保留的历史兼容文档补迁移说明，注明被什么 canonical 文档替代。

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
