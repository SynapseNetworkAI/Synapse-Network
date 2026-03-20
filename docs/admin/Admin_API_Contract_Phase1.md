# 管理后台第一期 API Contract

本文定义第一期管理后台接口契约，明确三层调用边界：

- `admin-front`：管理端页面与交互层
- `gateway-admin`：管理控制面 API、审批编排、审计入口
- `gateway`：交易真相层、账本与资金动作执行层

目标：

1. 管理后台前端不直接调用 `gateway` 的交易接口。
2. 所有管理员动作先进入 `gateway-admin` 的鉴权、权限校验、审批与审计层。
3. `gateway-admin` 对 `gateway` 的调用只通过受控 adapter 完成。

## 1. 第一期开口范围

第一期仅定义三组对外管理接口：

- `admin_auth`
- `dashboard`
- `approval`

统一前缀建议：

- 对前端暴露：`/api/admin/v1/*`
- 对健康检查暴露：`/health`

## 2. 通用规范

### 2.1 认证方式

第一期先采用 Bearer Token 占位契约：

- Header: `Authorization: Bearer <token>`
- Header: `X-Request-Id: <uuid>` 可选

后续可替换为：

- 企业 SSO 会话
- MFA challenge
- 短时 admin access token + refresh token

### 2.2 通用响应结构

成功响应：

```json
{
  "success": true,
  "data": {},
  "requestId": "req_123"
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Admin role is not allowed to approve this request"
  },
  "requestId": "req_123"
}
```

### 2.3 角色边界

第一期 contract 默认覆盖以下角色：

- `super_admin`
- `platform_ops_admin`
- `finance_admin`
- `finance_reviewer`
- `risk_admin`
- `risk_reviewer`
- `compliance_auditor`
- `readonly_analyst`

## 3. admin-front -> gateway-admin

## 3.1 admin_auth

### `POST /api/admin/v1/auth/login`

用途：管理员登录，由 `gateway-admin` 通过 `Set-Cookie` 下发 `HttpOnly` session cookie。

请求：

```json
{
  "email": "ops@synapse.network",
  "password": "not-used-in-phase-1",
  "otpCode": "123456"
}
```

响应：

```json
{
  "success": true,
  "data": {
    "expiresIn": 3600,
    "admin": {
      "adminId": "adm_finance_admin",
      "email": "ops@synapse.network",
      "displayName": "Finance Admin",
      "role": "finance_admin"
    }
  },
  "requestId": "req_demo"
}
```

响应头：

```text
Set-Cookie: synapse_admin_session=<opaque-session-token>; HttpOnly; Path=/; SameSite=Lax
```

### `GET /api/admin/v1/auth/me`

用途：前端基于 `HttpOnly` cookie 恢复登录态，获取当前管理员身份。

响应：

```json
{
  "success": true,
  "data": {
    "adminId": "adm_finance_admin",
    "email": "ops@synapse.network",
    "displayName": "Finance Admin",
    "role": "finance_admin",
    "permissions": [
      "dashboard:read",
      "approval:submit",
      "approval:read"
    ]
  },
  "requestId": "req_demo"
}
```

### `POST /api/admin/v1/auth/logout`

用途：退出后台会话。

请求体：空。

响应头会清理 `synapse_admin_session` cookie。

## 3.2 dashboard

### `GET /api/admin/v1/dashboard/overview`

用途：管理首页总览。

数据来源约束：

- `pendingApprovals` 来自 admin 控制面审批库
- `depositExceptions`、`auditAlerts`、`vaultLedgerDelta` 来自 gateway 只读投影视图 `synapse_admin_dashboard_projection`
- 这里说的“gateway 只读投影表”指的是由 gateway 真相表与运行态状态派生出来、仅供后台读取的读模型；当前第一版以 SQL view 实现，而不是新的资金真相表

响应：

```json
{
  "success": true,
  "data": {
    "metrics": {
      "pendingApprovals": 12,
      "depositExceptions": 3,
      "auditAlerts": 1,
      "vaultLedgerDelta": "0.00"
    },
    "highlights": [
      {
        "title": "待处理充值异常",
        "value": "3",
        "trend": "requires_attention"
      }
    ]
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/dashboard/system-status`

用途：读取控制面与交易面的关键状态摘要。

数据来源约束：

- `gatewayAdmin`、`approvalQueueDepth` 来自 admin 控制面
- `gateway`、`lastReconciliationAt` 来自 gateway 只读投影视图 `synapse_admin_dashboard_projection`

响应：

```json
{
  "success": true,
  "data": {
    "gatewayAdmin": "healthy",
    "gateway": "healthy",
    "approvalQueueDepth": 12,
    "lastReconciliationAt": "2026-03-16T08:00:00Z"
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/dashboard/finance-overview`

用途：读取稳定财务读模型快照，服务于后台资金总览卡片与对账状态展示。

数据来源约束：

- 来自 gateway 只读投影视图 `synapse_admin_dashboard_finance_projection`
- 该视图只允许由 gateway 真相表和持久化运行态派生，不允许拼接 admin 本地写模型

响应：

```json
{
  "success": true,
  "data": {
    "todayChargeUsdc": "1280.40",
    "todayDepositUsdc": "1640.00",
    "todayRefundUsdc": "42.25",
    "todayWithdrawalUsdc": "310.50",
    "ownerLiabilityUsdc": "8450.10",
    "providerPayableUsdc": "3920.45",
    "platformFeeBalanceUsdc": "128.75",
    "vaultLedgerDeltaUsdc": "0.50",
    "pendingDepositCount": 2,
    "pendingWithdrawalCount": 1,
    "projectedAt": "2026-03-16T08:05:00Z"
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/dashboard/activity-trends`

用途：读取 7 日稳定趋势读模型，供前端趋势表和后续告警/报表复用。

数据来源约束：

- 来自 gateway 只读投影视图 `synapse_admin_dashboard_activity_trend_projection`
- 每日桶聚合只包含持久化的充值、扣费、退款、提现与净流入数值

响应：

```json
{
  "success": true,
  "data": {
    "points": [
      {
        "bucketDate": "2026-03-16",
        "depositUsdc": "1640.00",
        "chargeUsdc": "1280.40",
        "refundUsdc": "42.25",
        "withdrawalUsdc": "310.50",
        "netFlowUsdc": "1287.25"
      }
    ]
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/dashboard/operations-overview`

用途：读取稳定运维读模型，暴露 indexer、backfill、reconciliation 与失败计数摘要。

数据来源约束：

- 来自 gateway 只读投影视图 `synapse_admin_dashboard_operations_projection`
- 只允许使用已持久化的 runtime state 和日志，不允许暴露仅存在于进程内存中的瞬时字段

响应：

```json
{
  "success": true,
  "data": {
    "gatewayStatus": "degraded",
    "indexerLastProcessedAt": "2026-03-16T08:03:00Z",
    "backfillLastScanAt": "2026-03-16T07:58:00Z",
    "backfillLastScannedBlock": 19450321,
    "recentGatewayFailures": 1,
    "failedDepositCount": 2,
    "recentAuditAlerts": 1,
    "lastReconciliationAt": "2026-03-16T08:00:00Z",
    "reconciliationAlert": true,
    "reconciliationDeltaUsdc": "0.50",
    "reconciliationLastError": "vault_delta_detected",
    "projectedAt": "2026-03-16T08:05:00Z"
  },
  "requestId": "req_demo"
}
```

## 3.3 approval

### `GET /api/admin/v1/approvals`

用途：分页读取审批单列表。

查询参数：

- `status`: 可选
- `approvalType`: 可选
- `limit`: 默认 20，最大 100

响应：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "approvalId": "APR-20260316-001",
        "approvalType": "refund_approve",
        "status": "UNDER_REVIEW",
        "approvalLevel": "L2",
        "requesterRole": "finance_admin",
        "amountUsdc": "150.00",
        "createdAt": "2026-03-16T08:00:00Z"
      }
    ],
    "nextCursor": null
  },
  "requestId": "req_demo"
}
```

### `POST /api/admin/v1/approvals`

用途：提交审批申请。

请求：

```json
{
  "approvalType": "deposit_repair",
  "resourceType": "deposit_intent",
  "resourceId": "dep_123",
  "approvalLevel": "L2",
  "amountUsdc": "100.00",
  "reason": "链上已确认但账本未入账",
  "payload": {
    "txHash": "0xabc",
    "ownerAddress": "0x123",
    "eventKey": "evt_123"
  }
}
```

### `POST /api/admin/v1/approvals/{approvalId}/decision`

用途：审批人做通过或拒绝决策。

请求：

```json
{
  "decision": "APPROVE",
  "comment": "证据完整，同意进入执行队列"
}
```

响应：

```json
{
  "success": true,
  "data": {
    "approvalId": "APR-20260316-001",
    "status": "APPROVED_PENDING_EXECUTION"
  },
  "requestId": "req_demo"
}
```

## 4. gateway-admin -> gateway

第一期先不把 `gateway` 内部调用暴露给前端，而是定义受控 adapter 边界。

## 4.1 Dashboard Adapter

`gateway-admin` 内部接口：

- `GatewayAdapter.get_system_status()`
- `GatewayAdapter.get_finance_overview()`

对应读取：

- `gateway /health`
- 未来的内部状态聚合接口或分析读库

## 4.2 Approval Execution Adapter

第一期只定义，不直接落执行动作：

- `GatewayAdapter.enqueue_deposit_repair()`
- `GatewayAdapter.enqueue_refund_execution()`
- `GatewayAdapter.enqueue_withdrawal_release()`

约束：

- 前端不得绕过 `gateway-admin` 直接触发这些动作
- `gateway-admin` 只有在审批流状态允许时才可调用 adapter

## 5. 第一阶段不做的内容

第一期 contract 暂不包含：

- 真实 SSO/OIDC 对接
- refresh token
- WebSocket 告警推送
- 实际资金执行接口
- 审计检索全文查询
- 报表导出

## 6. 落地建议

1. `admin-front` 只消费 `gateway-admin` 的 `/api/admin/v1/*`。
2. `gateway-admin` 内部把鉴权、路由、service、adapter 分层。
3. 真正写资金或配置的执行动作，在第二期接入审批通过后的执行器。
