# Synapse Agent-First Error Codes

> 当前错误码文档已切到 Agent-first Runtime 语义，不再保留旧角色二分叙事。

## 1. 设计目标

该文档定义 Agent Runtime 调用 Synapse Gateway 时可见的统一错误码契约，服务以下目标：

1. Agent 可直接按 `code` 做分支决策，而不是解析自然语言 message。
2. Dashboard、SDK、审计日志、测试断言使用同一套稳定机器语义。
3. 文档与当前已落地代码行为保持一致，不把尚未实现的理想码冒充现状。

## 2. 统一错误响应结构

当前 Gateway 对外错误响应统一遵循：

```json
{
  "detail": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "owner balance is insufficient, please deposit first"
  }
}
```

说明：

1. `detail.code` 是稳定契约，Agent 必须以它作为分支主键。
2. `detail.message` 面向人类调试和日志，不保证可作为稳定程序语义。
3. `requestId` 若存在于成功或失败链路，应在外层协议或审计记录中关联追踪，不应依赖错误文案传递。

## 3. 错误码分层

当前已落地错误码可按四层理解：

1. **Request Layer**：请求头、载荷、serviceId、requestId、schema 等输入问题。
2. **Credential Layer**：Credential 不存在、停用、过期、额度耗尽、速率超限。
3. **Quote / Invocation Layer**：Quote 生命周期、预算边界、幂等冲突、Invocation 作用域问题。
4. **Execution Layer**：服务状态、转发配置、QPS、上游失败、请求或响应体超限。

## 4. 已落地错误码矩阵

### 4.1 Generate Path

接口：`POST /api/v1/gateway/generate`

#### Request Layer

1. `PROMPT_REQUIRED` (`422`)：`prompt` 为空或全空白。
2. `PROMPT_TOO_LONG` (`422`)：`prompt` 超过平台最大长度，当前为 8000。
3. `SERVICE_ID_REQUIRED` (`422`)：Header 与 Body 均未提供 `serviceId`。
4. `SERVICE_ID_MISMATCH` (`403`)：Header 与 Body 的 `serviceId` 不一致。
5. `SERVICE_ID_INVALID_FORMAT` (`422`)：`serviceId` 不满足格式约束。
6. `CREDENTIAL_REQUIRED` (`401`)：缺少 `X-Credential`。
7. `CREDENTIAL_FORMAT_INVALID` (`422`)：`X-Credential` 格式非法。
8. `INVALID_REQUEST_ID` (`422`)：`X-Request-Id` 格式非法。
9. `REQUEST_REQUIRED_FIELDS_MISSING` (`422`)：请求体缺少该服务声明的必填字段。

#### Credential Layer

1. `CREDENTIAL_INVALID` (`401`)：Credential 不存在或无法解析到有效记录。
2. `CREDENTIAL_INACTIVE` (`401`)：Credential 已停用。
3. `CREDENTIAL_EXPIRED` (`401`)：Credential 已过期。
4. `CREDENTIAL_MAX_CALLS_EXCEEDED` (`429`)：Credential 总调用次数达到上限。
5. `CREDENTIAL_RPM_EXCEEDED` (`429`)：Credential 每分钟调用次数超限。
6. `CREDENTIAL_CREDIT_LIMIT_EXCEEDED` (`402`)：Credential 信用或消费窗口额度超限。

#### Execution / Billing Layer

1. `SERVICE_NOT_FOUND` (`404`)：Service 不存在。
2. `SERVICE_INACTIVE` (`403`)：Service 未激活。
3. `SERVICE_UNAVAILABLE` (`503`)：当前无健康 target 可路由。
4. `INVALID_SERVICE_PRICE` (`500`)：服务价格配置不合法。
5. `INVALID_INVOKE_CONFIG` (`500`)：Invoke 配置非法，如 method/contentType/targets/weight 不合法。
6. `INSUFFICIENT_BALANCE` (`402`)：Owner 余额不足，无法完成本次扣费。
7. `SERVICE_QPS_EXCEEDED` (`429`)：服务级 QPS 约束触发。
8. `REQUEST_PAYLOAD_TOO_LARGE` (`413`)：请求体超过服务最大请求字节数。
9. `RESPONSE_PAYLOAD_TOO_LARGE` (`413`)：上游响应体超过服务最大响应字节数。
10. `UPSTREAM_ERROR` (`502`)：上游调用失败或上游返回不可交付结果。

### 4.2 Agent Runtime Quote / Invocation / Receipt Path

接口：

- `POST /api/v1/agent/quotes`
- `POST /api/v1/agent/invocations`
- `GET /api/v1/agent/invocations/{invocation_id}`

#### Quote / Invocation Scope Layer

1. `QUOTE_NOT_FOUND` (`404`)：`quoteId` 不存在。
2. `QUOTE_CREDENTIAL_MISMATCH` (`403`)：Quote 不属于当前 Credential。
3. `QUOTE_EXPIRED` (`409`)：Quote 已过期，平台会将其状态标记为 `EXPIRED`。
4. `QUOTE_NOT_INVOKABLE` (`409`)：Quote 当前状态不可继续执行。
5. `IDEMPOTENCY_CONFLICT` (`409`)：同一 `idempotencyKey` 对应了不同的 `quoteId` 或 `payloadDigest`。
6. `INVOCATION_FORBIDDEN` (`403`)：Receipt 查询的 Invocation 不属于当前 Credential。

#### Budget / Risk Layer

1. `BUDGET_EXHAUSTED` (`402`)：生命周期预算不足。
2. `DAILY_LIMIT_EXCEEDED` (`402`)：日预算已打满。
3. `PER_INVOCATION_CAP_EXCEEDED` (`402`)：单次调用金额超过当前策略允许上限。
4. `CREDENTIAL_RPM_EXCEEDED` (`429`)：Invocation 前的 Credential RPM 守卫触发。
5. `SERVICE_QPS_EXCEEDED` (`429`)：Invocation 前的 Service QPS 守卫触发。

#### 复用 Generate Path 的执行错误

以下错误在 Agent Runtime Invocation 中也可能出现，语义与 `generate` 一致：

1. `SERVICE_NOT_FOUND`
2. `SERVICE_INACTIVE`
3. `SERVICE_UNAVAILABLE`
4. `INVALID_INVOKE_CONFIG`
5. `REQUEST_REQUIRED_FIELDS_MISSING`
6. `REQUEST_PAYLOAD_TOO_LARGE`
7. `RESPONSE_PAYLOAD_TOO_LARGE`
8. `UPSTREAM_ERROR`
9. `INSUFFICIENT_BALANCE`

## 5. Agent 推荐处理策略

### Auth / Credential 类

1. `CREDENTIAL_INVALID` / `CREDENTIAL_INACTIVE` / `CREDENTIAL_EXPIRED`：停止自动重试，回到 Owner 控制面重新签发或恢复 Credential。

### Budget / Balance 类

1. `INSUFFICIENT_BALANCE`：提示 Owner 充值或等待结算回补。
2. `BUDGET_EXHAUSTED` / `DAILY_LIMIT_EXCEEDED` / `PER_INVOCATION_CAP_EXCEEDED`：停止当前任务，切换低价服务、缩小任务范围或等待策略调整。

### Request / Contract 类

1. `REQUEST_REQUIRED_FIELDS_MISSING` / `SERVICE_ID_INVALID_FORMAT` / `CREDENTIAL_FORMAT_INVALID` / `INVALID_REQUEST_ID`：视为调用方请求构造错误，修复 payload 后再发起。
2. `REQUEST_PAYLOAD_TOO_LARGE`：压缩输入或拆分任务。
3. `RESPONSE_PAYLOAD_TOO_LARGE`：要求更小结果集，或改为异步/分段处理。

### Retryable Execution 类

1. `SERVICE_UNAVAILABLE` / `UPSTREAM_ERROR`：短退避重试，可切换候选服务。
2. `CREDENTIAL_RPM_EXCEEDED` / `SERVICE_QPS_EXCEEDED`：指数退避并尊重限流窗口，不要热循环冲击平台。

### State / Idempotency 类

1. `QUOTE_EXPIRED`：重新走 quote，不要复用旧 quote。
2. `QUOTE_NOT_INVOKABLE`：停止继续消费该 quote，重新创建 quote。
3. `IDEMPOTENCY_CONFLICT`：视为业务主键冲突，必须人工或编排逻辑修复，不能盲重试。
4. `INVOCATION_FORBIDDEN`：说明跨 Credential 越权读取 receipt，被平台拒绝。

## 6. 当前未落地但常被讨论的规划码

以下错误码在设计文档中出现过，但截至当前代码事实还未作为统一外部错误码落地，不应在 SDK 或前端里当成已发布契约使用：

1. `RATE_LIMITED`
2. `SCOPE_DENIED`
3. `PRICE_CHANGED`
4. `UPSTREAM_TIMEOUT`
5. `UPSTREAM_5XX`
6. `INVALID_PROVIDER_RESPONSE`

如果未来需要引入这些更细粒度错误码，必须同步更新：

1. 后端实现
2. 回归测试
3. `docs/api.md`
4. 本错误码文档

## 7. 版本与兼容规则

1. 新增错误码：允许，但必须补文档和测试。
2. 删除或重命名错误码：禁止，除非明确进行版本升级。
3. 同一语义不得在不同接口上发明多个名字。
4. 任何错误码语义变化都必须遵守 code-doc-test 一致性。
