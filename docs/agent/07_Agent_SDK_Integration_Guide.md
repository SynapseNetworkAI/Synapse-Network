# Agent SDK Integration Guide

> 目标：定义外部 Agent 如何接入 Synapse，稳定完成 `discover -> quote -> invoke -> receipt`。

## 1. 结论先说

推荐接入形态不是三选一，而是主次分层：

1. **主接口：SDK**
2. **主文档：Agent-readable Markdown contract**
3. **辅助工具：CLI（仅调试 / demo / 运维排障）**
4. **可选增强：Skills（仅 IDE / Copilot / chat agent 场景）**

核心判断标准只有一个：

**能不能让 Agent Runtime 在没有人工点页面的情况下，完成第一次自主付费调用。**

如果答案是否定的，这个集成形态就不是主路径。

## 2. 为什么主路径必须是 SDK

Runtime Agent 不是在写 prompt，它是在执行交易链路。

它必须具备下面这些能力：

1. 稳定请求 `POST /api/v1/agent/discovery/search`
2. 稳定请求 `POST /api/v1/agent/quotes`
3. 稳定请求 `POST /api/v1/agent/invocations`
4. 稳定轮询 `GET /api/v1/agent/invocations/{invocation_id}`
5. 自动处理 `X-Credential`、`X-Request-Id`、`idempotency_key`
6. 基于稳定错误码做重试、降级、终止
7. 保证 payload、quote、invoke、receipt 的结构化语义不漂移

这些能力，本质上都是程序执行能力，不是 prompt 能力。

所以：

- **SDK 是 Runtime 的执行面**
- **Markdown 是 Runtime 的理解面**
- **CLI 是人工调试面**
- **Skills 是 IDE Agent 的工作流面**

不要把这四层混成一坨。

## 3. 推荐产品形态

### 3.1 SDK 负责什么

SDK 至少要暴露四类能力：

1. `discover_services()` / `search_services()`
2. `create_quote()`
3. `create_invocation()`
4. `get_invocation_receipt()` / `wait_for_invocation()`

同时提供一个快捷 helper：

1. `call_service()` 或 `invoke_service()`

这个 helper 只是把 Quote 和 Invoke 串起来，方便已经拿到 `service_id` 的 Agent。

### 3.2 Markdown contract 负责什么

要给 Agent 一份机器友好的说明文档，明确告诉它：

1. 什么时候先 discover，什么时候直接 invoke
2. 什么时候必须 quote
3. `budget_check.allowed=false` 时必须停止
4. 什么错误可以重试，什么错误必须终止
5. `idempotency_key` 如何构造
6. 调用成功后要读取哪些字段
7. 哪些字段是平台内部字段，Agent 不该依赖

这份文档不是 marketing 文案，而是 Agent orchestration contract。

建议直接基于下面两份 canonical 文档：

1. `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
2. `docs/Gateway_Error_Codes.md`

## 4. 为什么不能把 Skills 当主方案

Skills 解决的是：

1. 在 Copilot / IDE / chat agent 中复用某种任务工作流
2. 给某类问题注入上下文与步骤模板
3. 约束一个 agent mode 该怎么思考和调用工具

它不解决：

1. Runtime HTTP transport
2. Idempotency
3. Credential header management
4. Receipt polling
5. Budget guard handling
6. Structured invocation contract

所以 Skills 不是 Synapse Runtime 的主接入方式。

**只有当你要让 Copilot、VS Code Agent、内部聊天 Agent 更懂 Synapse 操作规范时，才需要做 Skills。**

## 5. 为什么 CLI 只能做辅助层

CLI 有价值，但它的角色必须收敛：

1. 本地 demo
2. QA 联调
3. 运维排障
4. 人工验证 discovery / quote / invoke 合约

CLI 不适合作为外部 Agent 的正式 runtime integration surface，因为：

1. 进程调用链更重
2. 错误处理更粗
3. 结构化返回天然不如 SDK 稳定
4. Agent 还要做 stdout 解析，纯属给自己找复杂度

所以 CLI 可以有，但应该建立在 SDK 之上，而不是反过来。

## 6. Runtime Agent 的推荐调用顺序

### 6.1 标准闭环

1. `discover_services(intent, tags, limit=..., sort=...)`
2. 选择最合适的 `service_id`
3. `create_quote(service_id, input_preview=...)`
4. 如果 `budget_check.allowed == false`，立即停止
5. `create_invocation(quote_id, idempotency_key, payload)`
6. 如果不是终态，轮询 receipt
7. 基于 `status / error.code / error.action` 决定重试、降级或终止

### 6.2 适合直接 shortcut 的场景

只有满足下面两个条件，才建议跳过 discover：

1. Agent 已经明确知道要调用哪个 `service_id`
2. 上游编排已经完成服务选择

这时可以直接用 SDK helper：

1. `call_service(service_id, payload, idempotency_key=...)`

但 helper 内部仍然应该是 `quote -> invoke`，而不是回退到另一套旧协议。

## 7. 交付建议

如果现在要把 Synapse 对外做成真正可接入的 Agent 基础设施，建议按下面顺序交付：

1. **第一优先级：稳定 Python SDK**
2. **第二优先级：补 agent-readable integration markdown**
3. **第三优先级：再做 TypeScript SDK**
4. **第四优先级：最后补 CLI**
5. **只在需要 IDE 集成时，再补 Skills / custom agent definitions**

这条顺序的本质是：

**先把 Runtime 执行面做稳，再做提示层和操作层。**

## 8. 当前仓库落地建议

当前仓库已经有 Runtime API：

1. `POST /api/v1/agent/discovery/search`
2. `POST /api/v1/agent/quotes`
3. `POST /api/v1/agent/invocations`
4. `GET /api/v1/agent/invocations/{invocation_id}`

所以当前最正确的动作不是再造一套 skill-first 接入层，而是：

1. 让 `sdk/python/` 直接对齐这四个接口
2. 让 README 和 integration guide 明确标准调用顺序
3. 保持错误码、SDK、文档、测试四者一致

这才是 Agent First，而不是继续让人类在文档里手动拼 HTTP 请求。
