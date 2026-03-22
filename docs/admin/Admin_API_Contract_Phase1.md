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

当前控制面已经切到 cookie session + CSRF + step-up OTP 模式：

- 登录成功后由 `gateway-admin` 下发 `HttpOnly` admin session cookie
- 所有浏览器写请求都必须附带 `X-CSRF-Token: <csrfToken>`
- 高风险写请求额外要求 `X-Admin-OTP-Code: <6-digit-google-authenticator-code>`
- `X-Request-Id: <uuid>` 仍为可选调试头

当前高风险 step-up 保护接口包括：

- `POST /api/admin/v1/approvals/{approvalId}/decision`
- `POST /api/admin/v1/withdrawal-reviews/{withdrawalId}/decision`
- `POST /api/admin/v1/execution-jobs/{jobId}/retry`
- `POST /api/admin/v1/config/menu-items/publish`

### 2.4 菜单配置读取边界

菜单配置分成“原始配置读取”和“当前会话可见菜单读取”两类：

- `GET /api/admin/v1/config/menu-items?stage=draft|published`：返回原始配置快照，只允许控制面配置角色读取
- `GET /api/admin/v1/config/menu-items/visible`：返回已按当前管理员角色与权限裁剪后的 published 菜单，供后台壳子渲染

说明：

- 浏览器侧不再本地执行菜单权限判断，避免把未授权菜单项元数据暴露给前端
- `super_admin` 在 `visible` 视图里可见全部已发布菜单项
- 菜单项返回结构已经升级为树元数据平面表，前端按 `parentItemId` 组装递归导航
- `nodeType` 只允许 `category / page / panel`
- `page` 节点必须带 `href`，`category / panel` 允许 `href = null`
- `visible` 接口会自动补回仍然需要显示的祖先 `category` 与父 `page`，这样前端无需猜测展开路径

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

说明：

- 当 `GET /api/admin/v1/auth/policy` 返回 `loginTotpRequired=false` 时，`otpCode` 可省略
- 当 `loginTotpRequired=false` 时，登录页不显示 Google Authenticator 输入框，后端也不会因为未绑定 TOTP 因子而触发登录期 enrollment
- 当 `loginTotpRequired=true` 时，`otpCode` 必须是 Google Authenticator 当前 6 位验证码

响应：

```json
{
  "success": true,
  "data": {
    "expiresIn": 3600,
    "csrfToken": "<session-bound-csrf-token>",
    "security": {
      "loginTotpRequired": true,
      "highRiskTotpRequired": true,
      "totpIssuer": "Synapse Gateway Admin"
    },
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

说明：

- `csrfToken` 不是登录凭证，只用于浏览器侧写请求防 CSRF
- `admin-front` 需要在后续 `POST / PATCH / DELETE` 请求里附带 `X-CSRF-Token: <csrfToken>`
- 对高风险动作，`admin-front` 还需要额外附带 `X-Admin-OTP-Code: <google-authenticator-code>`

### `GET /api/admin/v1/auth/policy`

用途：在登录前获取当前环境的认证安全策略，让登录页按服务端配置显隐 Google Authenticator 输入框。

响应：

```json
{
  "success": true,
  "data": {
    "loginTotpRequired": true,
    "highRiskTotpRequired": true,
    "totpIssuer": "Synapse Gateway Admin"
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/auth/me`

用途：前端基于 `HttpOnly` cookie 恢复登录态，获取当前管理员身份。

响应：

```json
{
  "success": true,
  "data": {
    "expiresIn": 3600,
    "csrfToken": "<session-bound-csrf-token>",
    "security": {
      "loginTotpRequired": true,
      "highRiskTotpRequired": true,
      "totpIssuer": "Synapse Gateway Admin"
    },
    "admin": {
      "adminId": "adm_finance_admin",
      "email": "ops@synapse.network",
      "displayName": "Finance Admin",
      "role": "finance_admin",
      "permissions": [
        "dashboard:read",
        "approval:submit",
        "approval:read"
      ]
    }
  },
  "requestId": "req_demo"
}
```

### `POST /api/admin/v1/auth/logout`

用途：退出后台会话。

请求体：空。

响应头会清理 `synapse_admin_session` cookie。

请求头要求：

```text
X-CSRF-Token: <csrfToken>
```

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
- 视图 canonical 列已切换到 target-state 命名：`today_consumer_refund_usdc`、`today_provider_withdrawal_usdc`、`consumer_liability_usdc`
- 为兼容旧版 `gateway-admin`，视图仍保留 `todayRefundUsdc` 对应的底层 alias 列：`today_refund_usdc`、`today_withdrawal_usdc`、`owner_liability_usdc`、`pending_withdrawal_count`

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
- 视图 canonical 列已切换到 target-state 命名：`consumer_refund_usdc`、`provider_withdrawal_usdc`
- 为兼容旧版 `gateway-admin`，视图仍保留 alias 列：`refund_usdc`、`withdrawal_usdc`

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

### `GET /api/admin/v1/dashboard/reconciliation-detail`

用途：把 Finance 已识别的资金偏差信号展开为可操作的对账详情视图，说明偏差来自哪两组数、偏差方向以及当前关联 backlog。

数据来源约束：

- `reconciliationDeltaUsdc`、`gatewayStatus`、`reconciliationAlert`、`reconciliationLastError`、`projectedAt` 来自 gateway 只读投影视图
- `chainVaultUsdc`、`ledgerObligationUsdc`、`signedDifferenceUsdc`、`runtimeStateUpdatedAt` 来自持久化 runtime state `synapse_runtime_state(state_key='deposit_reconciliation_state')`
- `pendingApprovals` 来自 admin 审批库
- `depositExceptions`、`auditAlerts`、`pendingDepositCount`、`pendingWithdrawalCount`、`ownerLiabilityUsdc`、`providerPayableUsdc`、`platformFeeBalanceUsdc` 来自稳定 projection 或受控聚合，不允许前端自行拼装“详情”
- `priorityApprovals`、`depositRepairApprovals`、`pendingWithdrawalReviews` 必须由 `gateway-admin` 在后端聚合后返回，前端只负责展示和跳转，不得自行从多个列表接口拼装出“关联异常真相”
- `priorityApprovals[*].ownerAddress`、`requestId`、`txHash` 与 `pendingWithdrawalReviews[*]` 上的同名字段属于统一 locator 语义，供 reconciliation 页面发起同页 cross-locator drill-down

消费约束：

- 该接口的目的是回答“资金偏差信号从哪来”，前端应把它渲染为 operator 可读的详情页，而不是原始 JSON dump
- 若 runtime state 尚未落库，可保留 `chainVaultUsdc`、`ledgerObligationUsdc`、`signedDifferenceUsdc` 为 `null`，但仍必须返回稳定 projection 摘要字段
- 关联列表是为了把 operator 直接带到“下一步该处理什么”，不是把所有底层表字段平铺到页面上

响应：

```json
{
  "success": true,
  "data": {
    "gatewayStatus": "degraded",
    "reconciliationAlert": true,
    "reconciliationDeltaUsdc": "0.50",
    "signedDifferenceUsdc": "-0.50",
    "imbalanceDirection": "vault_deficit",
    "chainVaultUsdc": "8449.60",
    "ledgerObligationUsdc": "8450.10",
    "lastReconciliationAt": "2026-03-16T08:00:00Z",
    "runtimeStateUpdatedAt": "2026-03-16T08:00:00Z",
    "reconciliationLastError": "vault_delta_detected",
    "pendingApprovals": 3,
    "depositExceptions": 2,
    "auditAlerts": 1,
    "pendingDepositCount": 2,
    "pendingWithdrawalCount": 1,
    "ownerLiabilityUsdc": "8450.10",
    "providerPayableUsdc": "3920.45",
    "platformFeeBalanceUsdc": "128.75",
    "projectedAt": "2026-03-16T08:05:00Z",
    "priorityApprovals": [
      {
        "approvalId": "APR-20260316-001",
        "approvalType": "withdrawal_approve",
        "status": "UNDER_REVIEW",
        "approvalLevel": "L2",
        "requesterRole": "finance_admin",
        "amountUsdc": "200.00",
        "createdAt": "2026-03-16T08:04:00Z",
        "ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
        "requestId": "refund-review-001",
        "txHash": "0xref001"
      }
    ],
    "depositRepairApprovals": [
      {
        "approvalId": "APR-20260316-003",
        "approvalType": "deposit_repair",
        "status": "SUBMITTED",
        "approvalLevel": "L2",
        "requesterRole": "finance_admin",
        "amountUsdc": "150.00",
        "createdAt": "2026-03-16T08:02:00Z",
        "ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
        "requestId": "dep-repair-003",
        "txHash": "0xdep003"
      }
    ],
    "pendingWithdrawalReviews": [
      {
        "withdrawalId": "wd-demo-review-001",
        "ownerAddress": "0x1234...abcd",
        "amountUsdc": "88.00",
        "status": "PENDING_MANUAL_REVIEW",
        "requestId": "req_123",
        "txHash": null,
        "riskLevel": "red",
        "riskReasonCode": "velocity_limit",
        "evidenceSummary": "withdrawal frequency exceeded threshold",
        "message": null,
        "createdAt": "2026-03-16T08:01:00Z",
        "updatedAt": "2026-03-16T08:01:00Z"
      }
    ]
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/dashboard/reconciliation-drilldown`

用途：接收任一 `ownerAddress`、`requestId` 或 `txHash`，把该 locator 在对账详情关联的三类 backlog 中做统一交叉定位，并返回同页 drill-down 结果。

请求约束：

- 至少提供一个查询参数：`ownerAddress`、`requestId`、`txHash`
- 匹配语义由后端统一定义，前端不得分别对审批列表、充值修复和提现审核实现三套“搜索规则”
- 当前只返回 reconciliation detail 相关的活动审批和待审核提现单，不承担全站全文检索职责

消费约束：

- 该接口用于同页下钻，不替代审批中心或提现审核台的完整筛选页
- 若后端返回空数组，前端应明确显示 “No matches”，而不是把空结果解释为 locator 无效

响应：

```json
{
  "success": true,
  "data": {
    "ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
    "requestId": null,
    "txHash": null,
    "priorityApprovals": [
      {
        "approvalId": "APR-20260316-001",
        "approvalType": "withdrawal_approve",
        "status": "UNDER_REVIEW",
        "approvalLevel": "L2",
        "requesterRole": "finance_admin",
        "amountUsdc": "200.00",
        "createdAt": "2026-03-16T08:04:00Z",
        "ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
        "requestId": "refund-review-001",
        "txHash": "0xref001"
      }
    ],
    "depositRepairApprovals": [
      {
        "approvalId": "APR-20260316-003",
        "approvalType": "deposit_repair",
        "status": "FAILED",
        "approvalLevel": "L2",
        "requesterRole": "platform_ops_admin",
        "amountUsdc": "42.50",
        "createdAt": "2026-03-16T08:40:00Z",
        "ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
        "requestId": "dep-repair-003",
        "txHash": "0xdep003"
      }
    ],
    "pendingWithdrawalReviews": [
      {
        "withdrawalId": "wd-demo-review-001",
        "ownerAddress": "0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
        "amountUsdc": "88.00",
        "status": "PENDING_MANUAL_REVIEW",
        "requestId": "provider-withdraw-review-001",
        "txHash": null,
        "riskLevel": "red",
        "riskReasonCode": "velocity_limit",
        "evidenceSummary": "withdrawal frequency exceeded threshold",
        "message": null,
        "createdAt": "2026-03-16T08:01:00Z",
        "updatedAt": "2026-03-16T08:01:00Z"
      }
    ]
  },
  "requestId": "req_demo"
}
```

### `GET /api/admin/v1/dashboard/diagnostics`

用途：读取首页“Run controlled next steps”区域的真实诊断快照和建议动作，避免前端写死系统诊断卡片。

作用：

- 作为 admin 控制面的统一诊断语义层
- 给 dashboard 和 `/system` 提供同一份 `overallStatus`、`summary`、`signals`、`actions`
- 保证不同页面看到的是同一次受控聚合结论，而不是各自拼接后的“页面私有真相"

数据来源约束：

- `signals` 必须由 `gateway-admin` 受控聚合现有 dashboard projection、审批队列、执行任务和审计告警得到
- 不允许前端基于多个接口自行推导“诊断结论”后再伪装成后端事实
- `actions` 是后端下发的建议动作入口，前端只负责渲染和跳转，不自行发明 control-plane 语义

消费约束：

- dashboard 与 `/system` 必须复用该接口，不允许分别维护两套系统诊断口径
- 若某页面还需要展示更细 runtime 明细，可额外读取 `system-status` 或 `operations-overview`，但不得改写 `diagnostics` 的状态结论

响应：

```json
{
  "success": true,
  "data": {
    "overallStatus": "degraded",
    "checkedAt": "2026-03-21T10:00:00Z",
    "summary": "reconciliation delta 0.50 USDC, 1 failed execution job, 2 deposit exceptions",
    "signals": [
      {
        "signalId": "reconciliation",
        "label": "Reconciliation drift",
        "status": "degraded",
        "value": "0.50 USDC",
        "detail": "vault_delta_detected"
      }
    ],
    "actions": [
      {
        "actionId": "system-center",
        "label": "Open system center",
        "href": "/system",
        "detail": "inspect gateway, indexer, backfill, and reconciliation runtime state",
        "status": "degraded"
      }
    ]
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

## 5. menu_config

### `GET /api/admin/v1/config/menu-items/visible`

用途：返回当前会话真正可见的 published 菜单树元数据。

响应片段：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "itemId": "control-overview",
        "sectionId": "control-overview",
        "sectionLabel": "控制总览",
        "sectionDescription": "总览、执行态与系统健康。",
        "label": "控制总览",
        "href": null,
        "description": "控制台、执行队列和系统运行态的导航根节点。",
        "parentItemId": null,
        "nodeType": "category",
        "iconKey": "CT",
        "requiredRoles": [],
        "requiredPermissions": [],
        "sortOrder": 10,
        "keywords": ["overview", "dashboard", "runtime"]
      },
      {
        "itemId": "dashboard",
        "parentItemId": "control-overview",
        "nodeType": "category",
        "href": null,
        "iconKey": "OV",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "dashboard-overview",
        "parentItemId": "dashboard",
        "nodeType": "page",
        "href": "/dashboard/overview",
        "iconKey": "01",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "dashboard-runtime",
        "parentItemId": "dashboard",
        "nodeType": "page",
        "href": "/dashboard/runtime",
        "iconKey": "02",
        "requiredPermissions": ["dashboard:read"]
      }
    ],
    "meta": {
      "draftVersion": 3,
      "publishedVersion": 2,
      "isDirty": true,
      "updatedAt": "2026-03-21T12:00:00Z",
      "publishedAt": "2026-03-20T12:00:00Z",
      "updatedBy": "adm_super_admin",
      "publishedBy": "adm_super_admin"
    }
  },
  "requestId": "req_demo"
}
```

### `POST /api/admin/v1/config/menu-items`

用途：在 draft 版本里创建一个菜单树节点。

请求片段：

```json
{
  "itemId": "ops-copilot",
  "sectionId": "ops-controls",
  "sectionLabel": "业务控制",
  "sectionDescription": "审批、资金、风控和系统运维的受控操作入口。",
  "label": "运行副驾",
  "href": "/ops-copilot",
  "description": "值班辅助和运行手册入口。",
  "parentItemId": "business-control",
  "nodeType": "page",
  "iconKey": "OC",
  "requiredRoles": ["super_admin"],
  "requiredPermissions": ["dashboard:read"],
  "sortOrder": 265,
  "keywords": ["copilot", "runbook"]
}
```

约束：

- `parentItemId` 必须指向 draft 里的现存节点
- 不允许自引用或形成树环
- `href` 只对 `page` 做唯一性约束
- 删除父节点时服务端必须级联删除整个子树

## 6. 落地建议

1. `admin-front` 只消费 `gateway-admin` 的 `/api/admin/v1/*`。
2. `gateway-admin` 内部把鉴权、路由、service、adapter 分层。
3. 真正写资金或配置的执行动作，在第二期接入审批通过后的执行器。
