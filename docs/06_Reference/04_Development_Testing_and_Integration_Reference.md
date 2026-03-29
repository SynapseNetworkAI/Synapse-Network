# Development, Testing, and Integration Reference

- Status: canonical
- Code paths: `gateway/tests/`, `admin/gateway-admin/tests/`, `apps/frontend/`, `sdk/python/`
- Verified with: `npm run ci:gateway`, `npm run ci:admin-gateway`, `npm run ci:frontend`, `npm run ci:sdk-python`, `npm run ci:docs`
- DB sources: `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: root `docs/测试文档.md` as primary testing and reset entrypoint; former `docs/agent/07_Agent_SDK_Integration_Guide.md` for runtime SDK integration posture
- Last verified against code: 2026-03-24

## 1. Purpose

本文件给开发者、测试者和集成方一个最低共识清单，确保代码、测试、文档和 SDK 集成用的是同一套事实。

本模块已经吸收 former root `docs/测试文档.md` 的当前有效测试、重置和联调入口。原文件已完成退役，不再保留附录壳。

## 2. Canonical Reset And Replay Entry Points

本地或测试环境中涉及重置、清链路数据和重新验证主路径时，以这里的规则为准：

1. 仅允许在本地或测试环境执行数据重置，不得把 reset SQL 当成生产操作手册。
2. 重置前先确认当前连接目标是 `synapse_gateway`，而不是 `synapse_gateway_admin`。
3. 充值、调用、扣费、收益、提现的联调顺序，始终回到同一条 Agent-first 主链路：deposit -> confirmation -> invoke -> settlement -> withdrawal。
4. 当需要核对表级真理源时，先看 `docker-compose/postgres/init/gateway/001_synapse_schema.sql` 与 `docs/04_Database_Design/`，不要把测试脚本当成 schema 定义层。
5. 当需要 replay、backfill 或 reconciliation 验证时，优先遵守 `docs/05_DevOps_Deployment/03_Observability_Logging_and_Indexer_Operations.md` 的运行纪律。

## 3. Core Runtime Path

后端开发和联调，默认围绕这条 Agent-first 主链路：

1. Owner 完成入金
2. Gateway Indexer 确认充值
3. Agent 通过 Gateway 发起调用
4. Provider endpoint 被转发
5. Gateway 完成原子结算和审计

## 4. Test Priorities

至少覆盖：

1. owner-scoped auth and isolation
2. agent credential and budget enforcement
3. deposit idempotency and confirmation
4. gateway forwarding success and failure
5. consumer charge capture and rollback
6. provider receivable accrual and withdrawal review
7. audit emission and runtime state persistence

## 5. Test Structure

测试至少分成：

1. unit
2. integration
3. performance

性能测试应显式 gated，不应默认阻塞所有本地回归。

## 6. Test Naming

推荐使用业务意图命名，例如：

1. confirm deposit moves pending to available
2. invoke capture accrues provider receivable
3. withdrawal yellow path moves receivable to locked

## 7. SDK Minimums

SDK 调用前至少要具备：

1. 有效 Agent Credential
2. Owner 已完成入金并确认到账
3. 可访问的平台 Gateway URL

最小 Runtime 路径始终是：

1. discover
2. select or quote
3. invoke
4. receive unified result and billing facts

### 7.1 推荐接入优先级

对外 Agent 接入的主次顺序应固定为：

1. SDK 是 Runtime 执行面
2. canonical Markdown contract 是 Runtime 理解面
3. CLI 只做调试、demo 和排障
4. Skills 只用于 IDE / Copilot / chat agent 工作流增强

判断标准只有一个：能否让 Agent Runtime 在没有人工点页面的情况下，完成第一次自主付费调用。

### 7.2 推荐调用顺序

标准闭环：

1. `discover_services()` / `search_services()`
2. 选择 `service_id`
3. `create_quote()`
4. 若 `budget_check.allowed == false`，立即停止
5. `create_invocation()`
6. 若不是终态，轮询 receipt
7. 基于 `status / error.code / error.action` 做重试、降级或终止

只有当 Agent 已明确知道 `service_id` 且服务选择已由上游编排完成时，才适合走 helper 形式的 shortcut；但 helper 内部仍应保持 `quote -> invoke`，不能退回旧协议。

## 8. Sync Rule

任何行为变化，都必须同步更新：

1. 实现代码
2. 测试断言
3. 文档说明

三者不一致时，以真实代码行为为准，但必须立刻修正文档和测试。

## 9. Key Point

开发参考的真正价值，不是教人怎么跑单条命令，而是确保整个团队围绕同一条 Agent-first 主链路开发、测试、联调和回归。