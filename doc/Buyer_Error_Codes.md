# Synapse Buyer Error Codes (Unified Exception Contract)

## 1. 设计目标

该文档定义 Buyer 调用 Synapse Gateway 时可见的统一异常码规范，确保：

1. 业务可读：Buyer Agent 能直接按 code 分支处理。
2. 稳定兼容：错误处理逻辑不依赖 message 文案。
3. 可观测：每次请求可通过 requestId 和 code 追踪失败链路。

## 2. 返回结构约定

异常响应统一遵循结构：

```json
{
  "detail": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "buyer balance is insufficient, please deposit first"
  }
}
```

说明：

1. detail.code：稳定错误码（机器可读，兼容性契约）。
2. detail.message：人类可读说明（可迭代，不可作为分支主键）。

## 3. 命名规范

1. 全大写蛇形：DOMAIN_REASON。
2. 同一错误语义必须复用同一 code。
3. 安全相关错误遵循最小披露原则，避免泄露内部实现细节。

## 4. Generate 接口错误码矩阵

接口：POST /api/v1/gateway/generate

### 4.1 请求参数与格式

1. PROMPT_REQUIRED (422)：prompt 为空或全空白。
2. PROMPT_TOO_LONG (422)：prompt 超过最大长度（当前 8000）。
3. SERVICE_ID_REQUIRED (422)：缺少 serviceId（Header/Body 均未提供）。
4. SERVICE_ID_MISMATCH (403)：Header 与 Body 的 serviceId 不一致。
5. SERVICE_ID_INVALID_FORMAT (422)：serviceId 格式非法。
6. CREDENTIAL_REQUIRED (401)：缺少 X-Credential。
7. CREDENTIAL_FORMAT_INVALID (422)：X-Credential 格式非法。
8. INVALID_REQUEST_ID (422)：X-Request-Id 格式非法。
9. REQUEST_REQUIRED_FIELDS_MISSING (422)：请求体缺少该服务 invoke.request.schema.required 声明的必填字段。

### 4.2 凭据状态与调用额度

1. CREDENTIAL_INVALID (401)：凭据不存在或无效。
2. CREDENTIAL_INACTIVE (401)：凭据已停用。
3. CREDENTIAL_EXPIRED (401)：凭据已过期。
4. CREDENTIAL_MAX_CALLS_EXCEEDED (429)：调用次数超限。
5. CREDENTIAL_RPM_EXCEEDED (429)：速率限制触发。
6. CREDENTIAL_CREDIT_LIMIT_EXCEEDED (402)：信用额度不足。

### 4.3 服务可用性与计费状态

1. SERVICE_NOT_FOUND (404)：服务不存在。
2. SERVICE_INACTIVE (403)：服务被停用。
3. INVALID_SERVICE_PRICE (500)：服务价格配置异常。
4. INVALID_INVOKE_CONFIG (500)：服务转发配置异常。
5. INSUFFICIENT_BALANCE (402)：买家余额不足。
6. UPSTREAM_ERROR (502)：上游调用失败。

### 4.4 服务约束与资源保护

1. SERVICE_QPS_EXCEEDED (429)：服务级 QPS 超过注册约束阈值。
2. REQUEST_PAYLOAD_TOO_LARGE (413)：请求体超过 constraints.maxRequestBytes。
3. RESPONSE_PAYLOAD_TOO_LARGE (413)：上游响应超过 constraints.maxResponseBytes。

## 5. Seller 注册相关错误码（控制面）

接口：POST /api/v1/services

1. SERVICE_REGISTRATION_INVALID (422)：服务注册字段校验失败（包含 constraints 越界）。

## 6. Buyer Agent 推荐处理策略

1. 401/403：触发凭据重签发或权限检查。
2. 402：触发充值提醒或预算兜底逻辑。
3. 413：缩减请求体，或请求卖家调整服务约束。
4. 422：视为客户端参数错误，修复请求后重试。
5. 429：指数退避重试，避免持续冲击配额。
6. 502：短退避重试，并记录上游稳定性告警。

## 7. 版本与兼容策略

1. 新增错误码：允许（向后兼容）。
2. 删除或改名错误码：禁止，必须走版本变更流程。
3. 任何错误码语义变化必须同步更新：
   1. 代码实现
   2. 测试断言
   3. API 文档与本异常码文档
