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

用途：管理员登录，返回第一期占位 token。

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
    "accessToken": "adm_demo_finance_admin",
    "tokenType": "bearer",
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

### `GET /api/admin/v1/auth/me`

用途：前端恢复登录态，获取当前管理员身份。

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

## 3.2 dashboard

### `GET /api/admin/v1/dashboard/overview`

用途：管理首页总览。

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
