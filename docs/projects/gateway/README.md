# gateway

- Status: canonical
- Code paths: `gateway/`, `docs/03_Projects/gateway/`
- Verified with: `npm run ci:gateway`, `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 项目定位

`gateway/` 是 Synapse 的运行时结算与调用主链路。

它负责：

1. Agent Runtime discovery / quote / invoke 主协议落地
2. Credential、Budget、扣费、结算、收据主流程
3. Owner 充值、余额、账本、提现与风险门禁
4. 对 Provider Runtime 的调用路由与内部审计沉淀

一句话：如果 `contracts/` 是链上金库，`gateway/` 就是链下高速清算网关。

## 2. 代码位置

- 代码目录：`gateway/`
- 入口文件：`gateway/gateway_fastapi.py`
- 核心目录：`gateway/src/`
- 测试目录：`gateway/tests/`
- 环境模板：`gateway/.env.example`、`gateway/.env.local.example`、`gateway/.env.staging.example`、`gateway/.env.prod.example`

## 3. 项目内建议阅读顺序

1. `gateway/gateway_fastapi.py`
2. `gateway/src/`
3. `gateway/tests/`
4. 根目录 `README.md` 中的 gateway 启动说明

## 4. 职责边界

`gateway/` 应该承担：

1. Agent-facing runtime API
2. 资金一致性、账本、幂等、收据
3. Provider 调用编排与审计
4. 对链上金库与后台控制面的受控连接

`gateway/` 不应该承担：

1. 平台管理员控制面 UI 与后台治理逻辑
2. Provider 独立服务实现
3. SDK 分发与打包
4. 智能合约源码与部署脚本本体

## 5. 直接依赖关系

1. 依赖 `contracts/` 提供链上 Vault / Permit / Withdraw 能力
2. 被 `apps/frontend/` 作为用户与 Agent 控制台主要后端消费
3. 被 `admin/gateway-admin/` 通过内部受控接口调用
4. 作为 `sdk/python/` 的主要运行时对接面
5. 调用 `provider_service/` 或未来第三方 Provider Runtime

## 6. Canonical 文档入口

1. `docs/02_System_Architecture/02_Gateway_Runtime_Architecture.md`
2. `docs/03_Core_Workflows/02_Discovery_and_Gateway_Call.md`
3. `docs/03_Core_Workflows/README.md`
4. `docs/04_Database_Design/README.md`
5. `docs/04_Database_Design/01_SQL_Schema_Overview.md`
6. `docs/06_Reference/05_Runtime_API_Contract.md`
7. `docs/06_Reference/06_Runtime_Error_Code_Catalog.md`

## 7. 项目内应保留的贴身文档

根 `docs/03_Projects/gateway/` 当前集中维护：

1. [Gateway_Local_Development.md](./Gateway_Local_Development.md)

项目目录内只保留最小入口文档：

1. `gateway/README.md`
2. 如未来出现稳定、独立、长期维护的 gateway-only 工程规则，再评估是否需要 `gateway/AGENTS.md`
3. 必要时再补 `gateway/docs/Local_Runbook.md`

当前推荐先读本页，再进入 [Gateway_Local_Development.md](./Gateway_Local_Development.md) 看本地执行说明。

当前结论：`gateway/` 暂不新增独立 `AGENTS.md`。原因是现阶段它没有足够明确、长期稳定、需要脱离仓库总规范单独维护的 project-level rules；强行新增只会制造形式统一但内容空洞的规则文件。
