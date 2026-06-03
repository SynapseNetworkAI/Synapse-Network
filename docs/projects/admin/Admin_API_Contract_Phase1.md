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

第一期主要定义以下对外管理接口：

- `admin_auth`
- `dashboard`
- `approval`
- `provider_services`
- `provider_llm_config`
- `forum_support`
- `owner_accounts`
- `finance_operations`

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
- `GET /api/admin/v1/config/business-policy?stage=draft|published`
- `PATCH /api/admin/v1/config/business-policy`
- `POST /api/admin/v1/config/business-policy/publish`
- `GET /api/admin/v1/config/overview`
- `POST /api/admin/v1/provider-services/{serviceId}/lifecycle`
- `DELETE /api/admin/v1/provider-services/{serviceId}`
- `POST /api/admin/v1/provider-llm-config/rollout-requests`

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

### 2.5 业务参数配置中心边界

业务参数配置中心与菜单配置中心共享 `draft / published` 治理模式，但运行时边界不同：

- `GET /api/admin/v1/config/business-policy?stage=draft|published`：读取后台保存的业务参数草稿或已发布快照
- `PATCH /api/admin/v1/config/business-policy`：只更新 `draft`
- `POST /api/admin/v1/config/business-policy/publish`：把当前 `draft` 发布，并通过内部 gateway adapter 同步到 runtime published 配置
- `GET /api/admin/v1/config/overview`：聚合返回 draft、published、gateway runtime snapshot，以及 env-only / secret-only 配置来源摘要

说明：

- `super_admin` 才能修改 draft 和执行 publish；`platform_ops_admin` 默认只读。
- 业务参数配置只覆盖平台费率、提现阈值、风险限额、reconciliation alert 等业务策略字段。
- `RPC_URL`、`POSTGRES_DSN`、Webhook signing key、KMS key、内部 trigger URL 等基础设施配置不进入数据库可编辑范围。

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

## 3.0 owner_accounts

用途：给运营、support、risk 和 finance 提供业务用户只读查询入口。这里的“用户”指 `gateway` 里的 consumer/provider owner account，不是后台管理员账号；后台管理员仍由 `/users` 管理。

页面入口：

- `/owner-accounts`

权限：

1. `GET /api/admin/v1/owner-accounts`：`owner:read`
2. `GET /api/admin/v1/owner-accounts/{ownerId}`：`owner:read`
3. `includeEmail=true` 或完整邮箱 reveal：额外要求 `owner:pii:read`，并写 `owner_account.pii_reveal` audit

列表筛选：

- `q`
- `wallet`
- `email`
- `status`
- `includeEmail`
- `sort`
- `page`
- `pageSize`

响应约束：

- 默认只返回 masked email。
- `pendingEmail` 只用于说明待验证邮箱，不得用于交易通知投递。
- 详情页可返回余额、agent credentials、provider services、support cases、deposit/withdraw/refund/invocation 摘要，但全部为只读投影。

## 3.1 finance_operations

用途：把 Finance 页面从概览补齐为可查账的运营入口。V1 只做只读查询，不提供补账、修账、重放或强制释放按钮。

页面入口：

- `/finance` tab: `Consumer Deposits`
- `/finance` tab: `Provider Withdrawals`

权限：

1. `GET /api/admin/v1/finance/consumer-deposits`：`finance:read`
2. `GET /api/admin/v1/finance/consumer-deposits/{depositId}`：`finance:read`
3. `GET /api/admin/v1/finance/provider-withdrawals`：`finance:read`
4. `GET /api/admin/v1/finance/provider-withdrawals/{withdrawalId}`：`finance:read`
5. CSV/export 类动作如果后续开放，必须额外要求 `finance:export` 并写 audit。

列表通用分页：

- 默认 `pageSize=50`
- 最大 `pageSize=200`
- 支持 `status`、`wallet`、`txHash`、`dateFrom`、`dateTo`、`sort`

Consumer deposit 字段：

- `depositId`
- `ownerWallet`
- `ownerEmail` masked by default
- `txHash`
- `amountUsdc`
- `network`
- `status`
- `confirmations`
- `creditedAt`
- `createdAt`

Provider withdrawal 字段：

- `withdrawalId`
- `providerId`
- `providerName`
- `ownerWallet`
- `ownerEmail` masked by default
- `amountUsdc`
- `feeUsdc`
- `status`
- `txHash`
- `ticketId`
- `reviewDecision`
- `fundsState`

详情页证据：

- deposit detail 必须能展开 ledger entries、audit events、notification evidence。
- provider withdrawal detail 必须能展开 ledger entries、audit events、notification evidence、review history。
- 过期/失败 withdrawal 必须明确 `fundsState`，说明资金是否已退回 provider 可提现余额。

## 3.1.1 provider_llm_config

用途：把平台托管的 OpenAI-compatible LLM 接入从 env/catalog/onboarding 脚本升级为后台可见的治理面。这里不保存上游 API key，不执行 runtime 动态路由，也不替代 Gateway service registry。

页面入口：

- `/provider-llm-config`

权限：

1. `GET /api/admin/v1/provider-llm-config`：`dashboard:read`
2. `POST /api/admin/v1/provider-llm-config/rollout-requests`：`approval:submit`

只读快照字段：

- `vendors`：provider code、display name、base URL、API docs、pricing URL、环境覆盖、默认 timeout/QPS、secret reference、secret 是否存在、最近 smoke 状态。
- `models`：model id、display name、streaming/tool calling 能力、默认 max output tokens、绑定的 Synapse service ids。
- `pricingReviews`：token-metered 价格复核状态、source currency、input/output/cache 价格、markup、display amount、hold buffer、max auto hold。
- `rolloutStates`：环境、上线资格、prod opt-in、onboarding action、最近 smoke 和 blocked reason。

关键约束：

1. 当前 10 个新 LLM 默认 `pricingStatus=operator_review_required`，生产 `prod_enable` request 必须返回 `blocked`，直到运营完成价格复核。
2. `secretReference` 只能指向 Secret Manager 或部署环境变量；响应不得出现 `apiKey`、Owner private key 或 Gateway settlement 配置。
3. 后台动作只创建 rollout request；实际 onboarding dry-run、ensure、smoke 和 prod opt-in 仍由受控 onboarding job 执行。

## 3.2 forum_support

用途：把公开论坛里的未回复帖子收口到后台社区回复队列。Gateway-admin 负责权限、任务状态、Growing 建议写入、公开回复发送和审计边界；admin-front 只负责运营工作台展示与人工编辑。

页面入口：

- `/forum-support`

权限：

1. `GET /api/admin/v1/forum/response-tasks`：`support:read`
2. `GET /api/admin/v1/forum/response-tasks/{taskId}`：`support:read`
3. `POST /api/admin/v1/forum/response-tasks/{taskId}/send-reply`：`support:reply`
4. `POST /api/admin/v1/forum/response-tasks/{taskId}/ignore`：`support:triage`
5. `GET /api/admin/v1/forum/response-tasks/-/pending`：`X-Growing-Service-Token`
6. `POST /api/admin/v1/forum/response-tasks/{taskId}/suggestion`：`X-Growing-Service-Token`
7. `GET /api/admin/v1/forum/topics`：`support:read`
8. `GET /api/admin/v1/forum/topics/{topicId}`：`support:read`
9. `POST /api/admin/v1/forum/topics/{topicId}/close`：`support:triage`
10. `POST /api/admin/v1/forum/topics/{topicId}/reopen`：`support:triage`
11. `POST /api/admin/v1/forum/topics/{topicId}/pin`：`support:triage`
12. `POST /api/admin/v1/forum/topics/{topicId}/unpin`：`support:triage`

状态语义：

Forum topic lifecycle:

1. `open`：公开可见，可回复。
2. `awaiting_admin`：公开可见，可回复，需要官方回复。
3. `answered`：已有官方回复，仍可继续讨论。
4. `resolved`：已解决，仍可补充讨论。
5. `closed`：公开可见但禁止新回复，区别于隐藏。
6. `hidden`：普通用户不可见，仅后台审计。
7. `locked`：兼容锁定状态，禁止回复。

Forum response task lifecycle:

1. `awaiting_response`：新帖子等待管理员回复。
2. `draft_ready`：Growing/Agent 已生成建议草稿。
3. `responded`：管理员已发送公开 forum reply。
4. `ignored`：管理员填写原因后忽略。
5. `closed`：保留给后续系统关闭或批处理。

关键约束：

1. Growing/Agent 只写建议，不自动公开回复。
2. 公开回复必须由管理员编辑后手动发送。
3. 已进入 `responded / ignored / closed` 的历史任务必须只读，避免重复处理。
4. locked topic 发送回复必须返回明确错误，不得写入 `synapse_forum_replies`。
5. close topic 不隐藏内容，只锁定继续回复，并写入关闭原因与 lifecycle event。
6. pin/unpin 只影响公开列表排序和 badge，不改变 response task 状态。

### `GET /api/admin/v1/forum/response-tasks`

用途：分页读取社区回复任务。

Query:

1. `status`：逗号分隔状态，默认 `awaiting_response,draft_ready`
2. `classification`：`question / bug / feature_request / docs_issue / needs_more_info / spam`
3. `page`
4. `page_size`

响应：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "responseTaskId": "frt_demo",
        "topicId": "topic_demo",
        "status": "draft_ready",
        "source": "growing_agent",
        "priority": "high",
        "classification": "bug",
        "suggestedReply": "Thanks, we captured this as a bug candidate.",
        "linkedRequirementCandidateId": "42",
        "linkedRequirementId": null,
        "linkedWorkflowRunId": null,
        "topic": {
          "topicId": "topic_demo",
          "title": "Gateway timeout while opening FAQ route",
          "body": "FAQ route times out with 500",
          "category": "Bugs",
          "authorDisplay": "0x123"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPreviousPage": false
    }
  },
  "requestId": "req_123"
}
```

### `GET /api/admin/v1/forum/topics`

用途：后台分页读取所有帖子，用于 Forum Support Operations 的 `All Topics` 视图。

Query:

1. `status`：逗号分隔 topic 状态，默认 `open,awaiting_admin,answered,resolved`
2. `category`
3. `q`：搜索标题或正文
4. `pinned`：`true / false`
5. `page`
6. `page_size`：默认 20，最大 100

响应字段必须包含 `status`、`pinned`、`viewsCount`、`repliesCount`、`officialRepliesCount`、`closedReason`。

### `GET /api/admin/v1/forum/topics/{topicId}`

用途：读取单个帖子、活动 response task 和 lifecycle timeline。

响应：

```json
{
  "success": true,
  "data": {
    "topic": {
      "topicId": "topic_demo",
      "title": "Provider health issue",
      "status": "awaiting_admin",
      "pinned": true,
      "viewsCount": 42,
      "repliesCount": 1,
      "officialRepliesCount": 0,
      "closedReason": null
    },
    "responseTask": null,
    "events": [
      {
        "eventId": "fte_demo",
        "action": "pin",
        "fromStatus": "open",
        "toStatus": "open",
        "reason": null
      }
    ]
  },
  "requestId": "req_123"
}
```

### `POST /api/admin/v1/forum/topics/{topicId}/close`

用途：关闭公开帖子。帖子仍可被普通用户阅读，但 public reply API 必须拒绝新回复。

请求：

```json
{
  "reason": "Duplicate of an answered SDK setup issue."
}
```

### `POST /api/admin/v1/forum/topics/{topicId}/reopen`

用途：重新打开已关闭帖子，清除关闭原因并允许用户继续回复。

### `POST /api/admin/v1/forum/topics/{topicId}/pin`

用途：置顶帖子。公开 `/forum` 列表按 `pinned DESC, lastActivityAt DESC` 排序。

### `POST /api/admin/v1/forum/topics/{topicId}/unpin`

用途：取消置顶帖子。

### `POST /api/admin/v1/forum/response-tasks/{taskId}/send-reply`

用途：管理员发送最终公开回复，写入 `synapse_forum_replies`，并把 response task 标记为 `responded`。

请求：

```json
{
  "body": "Thanks, we are investigating this.",
  "authorDisplay": "Synapse Ops",
  "authorAddress": "synapse:ops"
}
```

### `POST /api/admin/v1/forum/response-tasks/{taskId}/ignore`

用途：管理员关闭不需要公开回复的任务。

请求：

```json
{
  "reason": "Duplicate topic already answered."
}
```

### Growing 内部建议接口

`GET /api/admin/v1/forum/response-tasks/-/pending` 读取待生成建议的任务。

`POST /api/admin/v1/forum/response-tasks/{taskId}/suggestion` 写回分类、优先级、建议回复和 Growing 链接：

```json
{
  "classification": "bug",
  "priority": "high",
  "suggestedReply": "Thanks, we captured this as a bug candidate.",
  "linkedRequirementCandidateId": "42",
  "linkedRequirementId": "req_42",
  "linkedWorkflowRunId": "wf_42",
  "metadata": {
    "source": "growing-agent"
  }
}
```

## 3.1 provider_services

用途：管理注册到 Gateway 的 Provider 服务、运行时探活状态和自动摘流状态。这里是控制台管理面，不是第二套路由或探活系统。

页面入口：

- `/provider-services`

权限：

1. `GET /api/admin/v1/provider-services`：`dashboard:read`
2. `GET /api/admin/v1/provider-services/{serviceId}`：`dashboard:read`
3. `POST /api/admin/v1/provider-services/{serviceId}/force-probe`：`dashboard:read`
4. `POST /api/admin/v1/provider-services/{serviceId}/lifecycle`：`approval:submit`
5. `DELETE /api/admin/v1/provider-services/{serviceId}`：`approval:submit`

状态语义：

1. 控制面生命周期：`draft / active / inactive / suspended / deleted`
2. 运行时健康：`unknown / probing / healthy / degraded / unhealthy / stale`
3. `active + unhealthy` 表示服务仍由控制面允许上线，但 Gateway 当前自动摘流；不允许 admin-front 把它显示成 Provider 主动下线。

### `GET /api/admin/v1/provider-services`

用途：分页读取非 deleted Provider 服务列表。

Query:

1. `query`：按 serviceId、服务名、Provider、摘要或 tag 搜索
2. `status`：控制面状态过滤
3. `runtimeStatus`：运行时状态过滤
4. `page`
5. `pageSize`

响应：

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "serviceId": "svc_quote",
        "ownerAddress": "0xProvider",
        "serviceName": "Quote Service",
        "summary": "Market quote provider",
        "tags": ["quote"],
        "pricing": {
          "amount": "0.01",
          "currency": "USDC"
        },
        "controlStatus": "active",
        "status": "active",
        "isActive": true,
        "runtimeStatus": "healthy",
        "runtimeAvailable": true,
        "health": {
          "overallStatus": "healthy",
          "probeStatus": "healthy",
          "healthyTargets": 1,
          "totalTargets": 1,
          "lastCheckedAt": 1776400000000,
          "isStale": false,
          "runtimeAvailable": true
        },
        "targets": []
      }
    ],
    "page": 1,
    "pageSize": 20,
    "totalCount": 1,
    "totalPages": 1
  },
  "requestId": "req_123"
}
```

### `POST /api/admin/v1/provider-services/{serviceId}/force-probe`

用途：立即对目标 service 执行一次健康探测，不改变控制面生命周期。

### `POST /api/admin/v1/provider-services/{serviceId}/lifecycle`

用途：执行控制面生命周期操作。

请求：

```json
{
  "action": "PAUSE",
  "note": "Provider requested maintenance window."
}
```

允许动作：

1. `PAUSE`：切到 `inactive`，停止 discovery / invoke，停止自动探活。
2. `RESUME`：切回 `active`，立即 probe，健康达标后自动恢复 discovery / invoke。
3. `SUSPEND`：切到 `suspended`，禁止 discovery / invoke，但保留探活和审计。

### `DELETE /api/admin/v1/provider-services/{serviceId}`

用途：逻辑删除非 active 服务。

约束：

1. `active` 服务不能直接删除，必须先 `PAUSE`。
2. 删除后 Gateway 不再自动探活，也不会进入 discovery / invoke。
3. 历史健康数据和 audit 保留，用于追溯。

## 3.2 admin_auth

### `POST /api/admin/v1/auth/login`

用途：管理员登录，由 `gateway-admin` 通过 `Set-Cookie` 下发 `HttpOnly` session cookie。

请求：

```json
{
  "email": "ops@synapse-network.ai",
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
      "email": "ops@synapse-network.ai",
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
      "email": "ops@synapse-network.ai",
      "displayName": "Finance Admin",
      "role": "finance_admin",
      "permissions": ["dashboard:read", "approval:submit", "approval:read"]
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

## 3.3 dashboard

### `GET /api/admin/v1/dashboard/overview`

用途：管理首页总览。

数据来源约束：

- `pendingApprovals` 来自统一审批工作队列，包含 admin 控制面审批库中的待处理审批，以及 gateway provider withdraw manual review 的只读投影待审项
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

- `gatewayAdmin` 来自 admin 控制面
- `approvalQueueDepth` 来自统一审批工作队列，包含 admin 控制面审批与 provider withdraw manual review 投影待审项
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
- 第一批资金链路观测增强字段也由该 projection 提供：`today_invocation_count`、`today_platform_fee_earned_usdc`、`today_provider_earned_usdc`
- `today_invocation_count`、`today_platform_fee_earned_usdc`、`today_provider_earned_usdc` 来源于 `synapse_invocations` 与 `synapse_invocation_billing`；旧 `synapse_runtime_state(invocation_billing::*)` 仅作为迁移期 fallback
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
    "todayInvocationCount": 342,
    "todayPlatformFeeEarnedUsdc": "196.40",
    "todayProviderEarnedUsdc": "1084.00",
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
- 每日桶聚合只包含持久化的充值、扣费、调用次数、平台手续费、Provider 收益、退款、提现与净流入数值
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
        "invocationCount": 342,
        "platformFeeEarnedUsdc": "196.40",
        "providerEarnedUsdc": "1084.00",
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
- `indexer / backfill / reconciliation` 的任务状态来自 `synapse_runtime_state(state_key='deposit_indexer_runtime_state')`，不再复用 `agent_runtime_projection_state` freshness proxy

响应：

```json
{
  "success": true,
  "data": {
    "gatewayStatus": "degraded",
    "indexerRunning": true,
    "indexerStatus": "healthy",
    "indexerLastProcessedAt": "2026-03-16T08:03:00Z",
    "indexerLastHeartbeatAt": "2026-03-16T08:04:00Z",
    "indexerLastError": null,
    "indexerPollIntervalSec": 30,
    "backfillEnabled": true,
    "backfillStatus": "healthy",
    "backfillLastScanAt": "2026-03-16T07:58:00Z",
    "backfillLastScannedBlock": 19450321,
    "backfillLastRecovered": 3,
    "backfillLastError": null,
    "recentGatewayFailures": 1,
    "failedDepositCount": 2,
    "recentAuditAlerts": 1,
    "reconciliationEnabled": true,
    "reconciliationStatus": "alert",
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
- `pendingApprovals` 来自统一审批工作队列，包含 admin 审批与 provider withdraw manual review 投影待审项
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
    "summary": "reconciliation alert present, 1 failed execution job, 2 deposit exceptions",
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
        "detail": "inspect gateway health, execution failures, and persisted task status for indexer, backfill, and reconciliation",
        "status": "degraded"
      }
    ]
  },
  "requestId": "req_demo"
}
```

说明：

- `system-center` 动作当前接入的是统一 diagnostics 语义层、execution failed jobs、approval queue 与 gateway projection 快照。
- `indexer / backfill / reconciliation` 在 `/system` 中当前展示的是持久化任务状态，来源于 gateway 持续刷新的 `deposit_indexer_runtime_state`。

## 3.4 approval

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
      },
      {
        "itemId": "analytics",
        "parentItemId": "dashboard",
        "nodeType": "category",
        "href": null,
        "iconKey": "AN",
        "requiredPermissions": ["dashboard:read"],
        "keywords": [
          "analytics",
          "events",
          "clickhouse",
          "growth",
          "revenue",
          "risk",
          "quality"
        ]
      },
      {
        "itemId": "dashboard-analytics",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics",
        "iconKey": "A0",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "analytics-consumer-funnel",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics/consumer-funnel",
        "iconKey": "AF",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "analytics-invocation-revenue",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics/invocation-revenue",
        "iconKey": "AI",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "analytics-provider-revenue",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics/provider-revenue",
        "iconKey": "AP",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "analytics-money-flow",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics/money-flow",
        "iconKey": "AM",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "analytics-risk-health",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics/risk-health",
        "iconKey": "AR",
        "requiredPermissions": ["dashboard:read"]
      },
      {
        "itemId": "analytics-data-quality",
        "parentItemId": "analytics",
        "nodeType": "page",
        "href": "/dashboard/analytics/data-quality",
        "iconKey": "AQ",
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
