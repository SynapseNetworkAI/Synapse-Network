# 管理后台数据库设计

本文基于现有管理后台架构、RBAC、审批流、审计合规和第一期 API contract，给出 `gateway-admin` 的数据库设计。

先给结论：

- `admin` 库是控制面数据库，不是新的交易账本数据库。
- 一期必须落地的表集中在四类：管理员身份、RBAC、审批编排、后台审计。
- 充值、提现、退款、余额等资金真相继续由 `gateway` 库维护，`admin` 侧只保存审批、执行、审计和关联指针，不重复造一份账本。

## 1. 设计目标

管理后台数据库必须解决四件事：

1. 独立管理员身份体系，不能复用普通用户登录态。
2. 独立 RBAC / SoD 权限模型，支持发起、审批、执行分离。
3. 独立审批状态机与执行编排，保证高风险动作可控。
4. 独立后台审计链，回答“谁申请、谁审批、谁执行、影响了什么”。

## 2. 数据边界

推荐采用下面的边界。

### 2.1 `gateway-admin` 自己拥有的表

这部分表属于控制面真相，由 `gateway-admin` 自己读写：

- 管理员用户与会话
- 角色、权限、角色绑定
- 审批单、审批步骤、审批事件
- 执行任务与执行重试记录
- 后台操作审计、审计导出记录

### 2.2 `gateway` 持续拥有的交易真相表

这部分真相继续由交易网关维护，`gateway-admin` 不直接写主真相：

- `synapse_account_balances`
- `synapse_vault_deposits`
- `synapse_vault_withdrawals`
- `synapse_invocations`
- `synapse_ledger_entries`
- `synapse_audit_events`
- `synapse_runtime_state`
- `synapse_processed_deposit_events`

后台补账、退款、提现放行等动作，必须走：

`admin approval -> admin execution job -> gateway controlled command`

而不是后台页面直接改这些交易表。

### 2.3 统计与大盘建议走只读投影

Dashboard 不建议自己再建一套交易明细真相表。一期建议：

- 实时状态走 `gateway` 内部受控接口
- 趋势统计走只读分析库或后续 projection

这意味着一期不强制需要 `admin_dashboard_*` 表。

## 3. 部署形态建议

生产目标：

- 物理上独立 `admin` 数据库
- 逻辑上分三个 schema：`admin_identity`、`admin_workflow`、`admin_audit`

如果一期为了交付速度先共用同一 PostgreSQL 实例，也建议至少做到：

- 表名前缀统一使用 `admin_`
- 使用独立数据库账号
- 管理员控制面表与交易表权限分离

## 4. 一期核心表清单

一期建议最少落下面 12 张表。

### 4.1 身份与会话域

#### `admin_users`

用途：管理员主档。

| 字段                    | 类型               | 说明                                          |
| ----------------------- | ------------------ | --------------------------------------------- |
| `admin_id`              | `TEXT` / `UUID` PK | 管理员主键                                    |
| `email`                 | `TEXT`             | 登录邮箱，大小写不敏感唯一                    |
| `display_name`          | `TEXT`             | 显示名                                        |
| `status`                | `TEXT`             | `active / disabled / locked / pending_invite` |
| `auth_source`           | `TEXT`             | `bootstrap / sso / oidc`                      |
| `sso_subject`           | `TEXT`             | SSO 或 OIDC subject，可空                     |
| `password_hash`         | `TEXT`             | 仅本地应急模式使用，可空                      |
| `require_mfa`           | `BOOLEAN`          | 是否强制 MFA                                  |
| `last_login_at`         | `TIMESTAMPTZ`      | 最近登录时间                                  |
| `failed_login_attempts` | `INTEGER`          | 连续密码或 OTP 登录失败次数，成功登录后清零   |
| `last_failed_login_at`  | `TIMESTAMPTZ`      | 最近一次登录失败时间                          |
| `locked_until`          | `TIMESTAMPTZ`      | 账号临时锁定到期时间；大于当前时间时拒绝登录  |
| `created_at`            | `TIMESTAMPTZ`      | 创建时间                                      |
| `updated_at`            | `TIMESTAMPTZ`      | 更新时间                                      |
| `disabled_at`           | `TIMESTAMPTZ`      | 禁用时间，可空                                |

关键约束与索引：

- `UNIQUE (lower(email))`
- `INDEX (status, updated_at DESC)`
- `INDEX (sso_subject)`
- `INDEX (locked_until) WHERE locked_until IS NOT NULL`

登录失败锁定策略：

1. 默认 `ADMIN_LOGIN_LOCK_THRESHOLD=5`，`ADMIN_LOGIN_LOCK_HOURS=24`。
2. 密码错误和 Google Authenticator OTP 错误共用同一个失败计数。
3. 第 5 次失败仍返回通用 `401 UNAUTHORIZED`，同时写入 `locked_until`。
4. 锁定期间登录返回 `423 ADMIN_ACCOUNT_LOCKED`，不向前端暴露剩余次数或锁定到期时间。
5. 成功登录或成功完成 MFA enrollment verify 后清零失败计数与锁定状态。

#### `admin_mfa_factors`

用途：管理员 MFA 因子主表。当前实现仍保留多因子通用 `payload_json`，但 TOTP secret 已不再直接明文放在 `payload_json` 里；运行态改为 `secret_ref` 持有加密后的 secret，`payload_json` 只保留非敏感元信息。

| 字段                      | 类型               | 说明                                                                                                     |
| ------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `factor_id`               | `TEXT` / `UUID` PK | MFA 因子主键                                                                                             |
| `admin_id`                | `TEXT` FK          | 关联 `admin_users.admin_id`                                                                              |
| `factor_type`             | `TEXT`             | `totp / webauthn / backup_code`                                                                          |
| `factor_label`            | `TEXT`             | 设备或因子名称                                                                                           |
| `status`                  | `TEXT`             | `pending / active / revoked`                                                                             |
| `secret_ref`              | `TEXT`             | 当前 TOTP secret 的加密存储位置。V1 先用应用层加密的 inline ref，长期可切到 KMS / Secret Manager / Vault |
| `totp_secret_fingerprint` | `TEXT`             | TOTP secret 的归一化指纹，只用于跨用户唯一约束，不保存明文                                               |
| `payload_json`            | `JSONB`            | 多因子通用结构化载荷。TOTP 只保留 `maskedSecret` / `secretStorage` 等非敏感元信息；WebAuthn 也复用这块   |
| `last_verified_at`        | `TIMESTAMPTZ`      | 最近验证时间                                                                                             |
| `created_at`              | `TIMESTAMPTZ`      | 创建时间                                                                                                 |
| `updated_at`              | `TIMESTAMPTZ`      | 更新时间                                                                                                 |
| `revoked_at`              | `TIMESTAMPTZ`      | 吊销时间                                                                                                 |

关键约束与索引：

- `INDEX (admin_id, status)`
- `UNIQUE (admin_id, factor_type, factor_label)`
- `UNIQUE (totp_secret_fingerprint) WHERE factor_type='totp' AND status IN ('pending','active')`

说明：

- `payload_json` 还保留着，不是因为 JSON 比字段更“安全”，而是这张表本来就是 `totp / webauthn / backup_code` 的多态因子表，WebAuthn 这类结构化载荷天然更适合走 JSON。
- 这轮已经堵住两类洞：同一个 Google Authenticator secret 被两个管理员共用，以及 TOTP 明文 secret 直接躺在 `payload_json`。
- 当前 V1 采用 `secret_ref=inline-fernet:v1:...` 的应用层加密方案；长期仍建议把 `secret_ref` 切到真正的 Secret Manager / KMS / Vault。

#### `admin_sessions`

用途：后台会话与 token 生命周期管理。

| 字段                 | 类型               | 说明                                  |
| -------------------- | ------------------ | ------------------------------------- |
| `session_id`         | `TEXT` / `UUID` PK | 会话主键                              |
| `admin_id`           | `TEXT` FK          | 关联管理员                            |
| `token_jti`          | `TEXT`             | access token 唯一标识                 |
| `refresh_token_hash` | `TEXT`             | refresh token 哈希，可空              |
| `status`             | `TEXT`             | `active / revoked / expired / locked` |
| `mfa_verified_at`    | `TIMESTAMPTZ`      | MFA 完成时间                          |
| `client_ip`          | `TEXT`             | 登录 IP                               |
| `user_agent`         | `TEXT`             | 设备标识                              |
| `issued_at`          | `TIMESTAMPTZ`      | 签发时间                              |
| `last_seen_at`       | `TIMESTAMPTZ`      | 最近活跃时间                          |
| `expires_at`         | `TIMESTAMPTZ`      | 过期时间                              |
| `revoked_at`         | `TIMESTAMPTZ`      | 撤销时间                              |
| `created_at`         | `TIMESTAMPTZ`      | 创建时间                              |

关键约束与索引：

- `UNIQUE (token_jti)`
- `INDEX (admin_id, status, expires_at DESC)`
- `INDEX (expires_at)`

### 4.2 RBAC 与授权域

#### `admin_roles`

用途：系统内置角色定义。第一期建议仍以固定角色为主，但表要先建好，避免把角色硬编码死在数据库之外。

| 字段          | 类型          | 说明                 |
| ------------- | ------------- | -------------------- |
| `role_key`    | `TEXT` PK     | 例如 `finance_admin` |
| `role_name`   | `TEXT`        | 角色展示名           |
| `description` | `TEXT`        | 角色说明             |
| `is_system`   | `BOOLEAN`     | 是否系统内置角色     |
| `status`      | `TEXT`        | `active / disabled`  |
| `created_at`  | `TIMESTAMPTZ` | 创建时间             |
| `updated_at`  | `TIMESTAMPTZ` | 更新时间             |

#### `admin_permissions`

用途：权限点字典。

| 字段              | 类型          | 说明                                        |
| ----------------- | ------------- | ------------------------------------------- |
| `permission_key`  | `TEXT` PK     | 例如 `approval:decide`                      |
| `resource_domain` | `TEXT`        | 例如 `approval`、`audit`、`system`          |
| `action`          | `TEXT`        | `read / submit / decide / export / execute` |
| `risk_level`      | `TEXT`        | `low / medium / high / critical`            |
| `description`     | `TEXT`        | 权限说明                                    |
| `created_at`      | `TIMESTAMPTZ` | 创建时间                                    |

#### `admin_role_permissions`

用途：角色与权限映射。

| 字段             | 类型          | 说明       |
| ---------------- | ------------- | ---------- |
| `role_key`       | `TEXT` FK     | 关联角色   |
| `permission_key` | `TEXT` FK     | 关联权限   |
| `created_at`     | `TIMESTAMPTZ` | 创建时间   |
| `created_by`     | `TEXT`        | 变更操作者 |

主键建议：

- `PRIMARY KEY (role_key, permission_key)`

#### `admin_user_role_bindings`

用途：管理员与角色绑定，支持作用域与生效期，为后续 ABAC 留接口。

| 字段           | 类型               | 说明                               |
| -------------- | ------------------ | ---------------------------------- |
| `binding_id`   | `TEXT` / `UUID` PK | 绑定主键                           |
| `admin_id`     | `TEXT` FK          | 管理员                             |
| `role_key`     | `TEXT` FK          | 角色                               |
| `scope_json`   | `JSONB`            | 可选作用域，例如环境、业务线、区域 |
| `status`       | `TEXT`             | `active / expired / revoked`       |
| `granted_by`   | `TEXT`             | 授权人                             |
| `grant_reason` | `TEXT`             | 授权原因                           |
| `starts_at`    | `TIMESTAMPTZ`      | 生效时间                           |
| `expires_at`   | `TIMESTAMPTZ`      | 过期时间                           |
| `created_at`   | `TIMESTAMPTZ`      | 创建时间                           |
| `updated_at`   | `TIMESTAMPTZ`      | 更新时间                           |

关键约束与索引：

- `INDEX (admin_id, status)`
- `INDEX (role_key, status)`
- 建议限制同一管理员同一角色只能存在一条 active 绑定

### 4.3 审批与执行域

#### `admin_approvals`

用途：审批主表，是后台控制面的核心真相。

| 字段                  | 类型             | 说明                                                                                                                             |
| --------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `approval_id`         | `TEXT` PK        | 例如 `APR-20260316-001`                                                                                                          |
| `approval_type`       | `TEXT`           | `deposit_repair / refund_approve / withdrawal_approve / fee_policy_change`                                                       |
| `approval_level`      | `TEXT`           | `L1 / L2 / L3 / L4`                                                                                                              |
| `status`              | `TEXT`           | `DRAFT / SUBMITTED / UNDER_REVIEW / APPROVED_PENDING_EXECUTION / EXECUTING / EXECUTED / REJECTED / FAILED / CANCELLED / EXPIRED` |
| `requester_id`        | `TEXT` FK        | 发起人                                                                                                                           |
| `current_approver_id` | `TEXT` FK        | 当前审批人，可空                                                                                                                 |
| `resource_type`       | `TEXT`           | 例如 `deposit_intent`                                                                                                            |
| `resource_id`         | `TEXT`           | 目标业务对象 ID                                                                                                                  |
| `owner_address`       | `TEXT`           | 受影响钱包地址，可空                                                                                                             |
| `tx_hash`             | `TEXT`           | 关联链上交易，可空                                                                                                               |
| `event_key`           | `TEXT`           | 关联链上事件键，可空                                                                                                             |
| `risk_level`          | `TEXT`           | `green / yellow / red`                                                                                                           |
| `amount_usdc`         | `NUMERIC(36, 6)` | 影响金额                                                                                                                         |
| `reason`              | `TEXT`           | 发起原因                                                                                                                         |
| `payload_json`        | `JSONB`          | 动作参数快照                                                                                                                     |
| `request_id`          | `TEXT`           | 前端请求号                                                                                                                       |
| `trace_id`            | `TEXT`           | 技术链路号                                                                                                                       |
| `submitted_at`        | `TIMESTAMPTZ`    | 提交时间                                                                                                                         |
| `approved_at`         | `TIMESTAMPTZ`    | 审批通过时间                                                                                                                     |
| `rejected_at`         | `TIMESTAMPTZ`    | 审批拒绝时间                                                                                                                     |
| `executed_at`         | `TIMESTAMPTZ`    | 执行成功时间                                                                                                                     |
| `expires_at`          | `TIMESTAMPTZ`    | 过期时间                                                                                                                         |
| `created_at`          | `TIMESTAMPTZ`    | 创建时间                                                                                                                         |
| `updated_at`          | `TIMESTAMPTZ`    | 更新时间                                                                                                                         |

关键约束与索引：

- `INDEX (status, created_at DESC)`
- `INDEX (approval_type, status, created_at DESC)`
- `INDEX (requester_id, created_at DESC)`
- `INDEX (current_approver_id, status, created_at DESC)`
- `INDEX (resource_type, resource_id)`
- `INDEX (tx_hash)`

#### `admin_approval_steps`

用途：多级审批步骤表，解决 L2/L3/L4 审批链和 SoD 约束。

| 字段                  | 类型               | 说明                                 |
| --------------------- | ------------------ | ------------------------------------ |
| `step_id`             | `TEXT` / `UUID` PK | 步骤主键                             |
| `approval_id`         | `TEXT` FK          | 所属审批单                           |
| `step_no`             | `INTEGER`          | 第几级审批                           |
| `required_role`       | `TEXT`             | 本步骤要求角色                       |
| `required_permission` | `TEXT`             | 本步骤要求权限                       |
| `approver_id`         | `TEXT` FK          | 实际审批人，可空                     |
| `decision`            | `TEXT`             | `APPROVE / REJECT / ESCALATE / SKIP` |
| `decision_comment`    | `TEXT`             | 审批意见                             |
| `assigned_at`         | `TIMESTAMPTZ`      | 分配时间                             |
| `decided_at`          | `TIMESTAMPTZ`      | 决策时间                             |
| `due_at`              | `TIMESTAMPTZ`      | 截止时间                             |
| `metadata_json`       | `JSONB`            | 扩展信息                             |
| `created_at`          | `TIMESTAMPTZ`      | 创建时间                             |

关键约束与索引：

- `UNIQUE (approval_id, step_no)`
- `INDEX (approver_id, due_at)`

#### `admin_approval_events`

用途：审批状态机事件流，记录每次状态变化与责任链。

| 字段            | 类型           | 说明                                                                                          |
| --------------- | -------------- | --------------------------------------------------------------------------------------------- |
| `event_id`      | `BIGSERIAL` PK | 事件主键                                                                                      |
| `approval_id`   | `TEXT` FK      | 所属审批单                                                                                    |
| `event_type`    | `TEXT`         | `CREATED / SUBMITTED / ASSIGNED / APPROVED / REJECTED / EXECUTION_STARTED / EXECUTION_FAILED` |
| `operator_id`   | `TEXT`         | 操作者                                                                                        |
| `operator_role` | `TEXT`         | 操作者角色                                                                                    |
| `from_status`   | `TEXT`         | 原状态                                                                                        |
| `to_status`     | `TEXT`         | 新状态                                                                                        |
| `comment`       | `TEXT`         | 补充说明                                                                                      |
| `request_id`    | `TEXT`         | 请求号                                                                                        |
| `trace_id`      | `TEXT`         | 链路号                                                                                        |
| `detail_json`   | `JSONB`        | 事件细节                                                                                      |
| `created_at`    | `TIMESTAMPTZ`  | 发生时间                                                                                      |

关键约束与索引：

- `INDEX (approval_id, created_at ASC)`
- `INDEX (event_type, created_at DESC)`

#### `admin_execution_jobs`

用途：审批通过后的执行任务队列，保证控制面和交易执行面解耦。

| 字段                   | 类型               | 说明                                                                      |
| ---------------------- | ------------------ | ------------------------------------------------------------------------- |
| `job_id`               | `TEXT` / `UUID` PK | 执行任务主键                                                              |
| `approval_id`          | `TEXT` FK          | 来源审批单                                                                |
| `execution_type`       | `TEXT`             | `deposit_repair / refund_execute / withdrawal_release / fee_policy_apply` |
| `target_system`        | `TEXT`             | `gateway / config_center / analytics`                                     |
| `status`               | `TEXT`             | `PENDING / RUNNING / SUCCEEDED / FAILED / CANCELLED`                      |
| `idempotency_key`      | `TEXT`             | 执行幂等键                                                                |
| `handler_name`         | `TEXT`             | 处理器名                                                                  |
| `request_payload_json` | `JSONB`            | 发送给执行器的参数                                                        |
| `result_payload_json`  | `JSONB`            | 执行结果快照                                                              |
| `error_code`           | `TEXT`             | 失败错误码                                                                |
| `error_message`        | `TEXT`             | 失败摘要                                                                  |
| `queued_by`            | `TEXT`             | 入队操作者                                                                |
| `started_at`           | `TIMESTAMPTZ`      | 开始执行时间                                                              |
| `finished_at`          | `TIMESTAMPTZ`      | 完成时间                                                                  |
| `retry_count`          | `INTEGER`          | 已重试次数                                                                |
| `max_retry_count`      | `INTEGER`          | 最大重试次数                                                              |
| `created_at`           | `TIMESTAMPTZ`      | 创建时间                                                                  |
| `updated_at`           | `TIMESTAMPTZ`      | 更新时间                                                                  |

关键约束与索引：

- `UNIQUE (idempotency_key)`
- `INDEX (approval_id)`
- `INDEX (status, created_at DESC)`

#### `admin_execution_attempts`

用途：执行重试明细。没有这张表，后续排查“为什么补账单重试 3 次还失败”会直接瞎。

| 字段              | 类型           | 说明                           |
| ----------------- | -------------- | ------------------------------ |
| `attempt_id`      | `BIGSERIAL` PK | 重试记录主键                   |
| `job_id`          | `TEXT` FK      | 所属执行任务                   |
| `attempt_no`      | `INTEGER`      | 第几次执行                     |
| `status`          | `TEXT`         | `RUNNING / SUCCEEDED / FAILED` |
| `request_id`      | `TEXT`         | 执行请求号                     |
| `trace_id`        | `TEXT`         | 链路号                         |
| `started_at`      | `TIMESTAMPTZ`  | 开始时间                       |
| `finished_at`     | `TIMESTAMPTZ`  | 完成时间                       |
| `error_code`      | `TEXT`         | 失败错误码                     |
| `error_summary`   | `TEXT`         | 失败摘要                       |
| `response_digest` | `TEXT`         | 执行结果摘要                   |

关键约束与索引：

- `UNIQUE (job_id, attempt_no)`
- `INDEX (job_id, started_at ASC)`

### 4.4 审计与合规模块

#### `admin_action_audit`

用途：后台控制面统一审计主表。

| 字段             | 类型           | 说明                                                             |
| ---------------- | -------------- | ---------------------------------------------------------------- |
| `audit_id`       | `BIGSERIAL` PK | 审计主键                                                         |
| `action_type`    | `TEXT`         | 例如 `admin.login.success`、`approval.submit`、`approval.decide` |
| `operator_id`    | `TEXT`         | 操作者                                                           |
| `operator_email` | `TEXT`         | 操作者邮箱                                                       |
| `operator_role`  | `TEXT`         | 操作者角色                                                       |
| `session_id`     | `TEXT`         | 会话号                                                           |
| `approval_id`    | `TEXT`         | 关联审批单，可空                                                 |
| `job_id`         | `TEXT`         | 关联执行任务，可空                                               |
| `request_id`     | `TEXT`         | 请求号                                                           |
| `trace_id`       | `TEXT`         | 链路号                                                           |
| `resource_type`  | `TEXT`         | 资源类型                                                         |
| `resource_id`    | `TEXT`         | 资源 ID                                                          |
| `result_status`  | `TEXT`         | `success / failure / denied`                                     |
| `error_code`     | `TEXT`         | 错误码                                                           |
| `client_ip`      | `TEXT`         | 客户端 IP                                                        |
| `user_agent`     | `TEXT`         | 设备信息                                                         |
| `before_json`    | `JSONB`        | 变更前快照                                                       |
| `after_json`     | `JSONB`        | 变更后快照                                                       |
| `detail_json`    | `JSONB`        | 额外上下文                                                       |
| `created_at`     | `TIMESTAMPTZ`  | 记录时间                                                         |

关键约束与索引：

- `INDEX (operator_id, created_at DESC)`
- `INDEX (approval_id, created_at DESC)`
- `INDEX (request_id)`
- `INDEX (resource_type, resource_id, created_at DESC)`
- `INDEX (action_type, created_at DESC)`

#### `admin_audit_exports`

用途：审计导出留痕。没有它，导出就是黑洞。

| 字段                      | 类型               | 说明                                     |
| ------------------------- | ------------------ | ---------------------------------------- |
| `export_id`               | `TEXT` / `UUID` PK | 导出任务主键                             |
| `operator_id`             | `TEXT`             | 导出发起人                               |
| `export_scope`            | `TEXT`             | `approval / audit_admin / audit_finance` |
| `filters_json`            | `JSONB`            | 导出过滤条件                             |
| `row_count`               | `INTEGER`          | 导出行数                                 |
| `contains_sensitive_data` | `BOOLEAN`          | 是否包含敏感字段                         |
| `status`                  | `TEXT`             | `queued / completed / failed / expired`  |
| `file_ref`                | `TEXT`             | 文件引用或对象存储地址                   |
| `created_at`              | `TIMESTAMPTZ`      | 创建时间                                 |
| `expires_at`              | `TIMESTAMPTZ`      | 过期时间                                 |

关键约束与索引：

- `INDEX (operator_id, created_at DESC)`
- `INDEX (status, created_at DESC)`

### 4.5 `admin_config_documents`

用途：保存控制面的文档型配置快照。当前已落两类配置：

- `admin_menu_config`：后台导航树
- `business_policy_config`：业务策略参数配置中心草稿/发布快照

| 字段                     | 类型          | 说明                               |
| ------------------------ | ------------- | ---------------------------------- |
| `config_key`             | `TEXT` PK     | 配置类型，例如 `admin_menu_config` |
| `draft_payload_json`     | `JSONB`       | 草稿配置快照                       |
| `published_payload_json` | `JSONB`       | 已发布配置快照                     |
| `draft_version`          | `INTEGER`     | 草稿版本号                         |
| `published_version`      | `INTEGER`     | 已发布版本号                       |
| `updated_by`             | `TEXT` FK     | 最近编辑人                         |
| `published_by`           | `TEXT` FK     | 最近发布人                         |
| `created_at`             | `TIMESTAMPTZ` | 创建时间                           |
| `updated_at`             | `TIMESTAMPTZ` | 最近草稿更新时间                   |
| `published_at`           | `TIMESTAMPTZ` | 最近发布时间                       |

`admin_menu_config` 的 payload 采用文档型树节点数组：

```json
{
  "items": [
    {
      "itemId": "business-control",
      "parentItemId": null,
      "nodeType": "category",
      "label": "业务控制",
      "href": null,
      "iconKey": "BC",
      "requiredRoles": [],
      "requiredPermissions": [],
      "keywords": ["approvals", "finance", "risk"]
    },
    {
      "itemId": "approvals",
      "parentItemId": "business-control",
      "nodeType": "page",
      "label": "审批中心",
      "href": "/approvals",
      "requiredPermissions": ["approval:read"]
    }
  ]
}
```

设计约束：

- `page` 节点必须带 `href`，`category / panel` 必须允许 `href = null`。
- `parentItemId` 形成树结构，删除父节点时必须级联删除子树，避免孤儿节点。
- `iconKey`、`keywords` 属于 IA/搜索元数据，不应该再散落在前端硬编码常量里。
- `draft_payload_json` 与 `published_payload_json` 必须是完整快照，而不是 patch 日志，这样前端壳子和审计回溯都更稳定。

`business_policy_config` 的 payload 采用按域分组的业务参数快照：

```json
{
  "finance": {
    "platformFeeRate": "0.100000",
    "gatewayRoutingTaxUsdc": "0.000100",
    "consumerWithdrawFeeUsdc": "0.500000",
    "consumerDepositMinUsdc": "5.000000"
  },
  "consumerWithdraw": {
    "minUsdc": "10.000000",
    "manualReviewThresholdUsdc": "500.000000",
    "maxDailyCount": 3,
    "maturitySeconds": 604800
  },
  "risk": {
    "withdrawalAutoSingleLimitUsdc": "100.000000",
    "withdrawalAuto24hLimitUsdc": "500.000000",
    "withdrawalWindowHours": 24
  },
  "reconciliation": {
    "alertDeltaUsdc": "1.000000"
  }
}
```

`business_policy_config` 的关键边界：

- 这里只保存 **业务策略参数** 的 `draft / published` 快照。
- `published` 真正生效时，会通过受控 publish 动作同步到 gateway 可读的运行时表 `synapse_business_policy_config`。
- `RPC_URL`、`POSTGRES_DSN`、Webhook signing key、KMS key、内部 trigger URL 等 secrets / infra 配置 **不进入** 这个文档配置中心。

## 5. 一期可以暂缓的表

下面这些表不是一期必须，但二期很可能会补：

- `admin_system_configs`：其他后台配置中心主表
- `admin_config_change_versions`：配置版本与回滚历史
- `admin_alert_subscriptions`：后台告警订阅
- `admin_dashboard_snapshots`：大盘缓存快照
- `admin_support_cases`：客服工单域

如果当前目标是先把 `admin_auth + dashboard + approval` 跑通，这些表可以后置，不要一上来把 schema 膨胀成怪兽。

## 6. 明确不该新增的重复表

以下表不建议在 `admin` 库再复制一份：

- `admin_balances`
- `admin_deposit_intents`
- `admin_refund_intents`
- `admin_withdrawal_intents`
- `admin_runtime_state`

原因很简单：

- 这些是交易真相
- 真相只能有一处
- 后台只保存审批与审计关联键，不保存第二份可写账本

否则后面一定出现“后台状态和交易状态打架”的架构警报。

## 7. 推荐外键与关系图

```text
admin_users
  ├─< admin_mfa_factors
  ├─< admin_sessions
  └─< admin_user_role_bindings >─ admin_roles ─< admin_role_permissions >─ admin_permissions

admin_users
  ├─< admin_approvals.requester_id
  ├─< admin_approvals.current_approver_id
  ├─< admin_approval_steps.approver_id
  └─< admin_action_audit.operator_id

admin_approvals
  ├─< admin_approval_steps
  ├─< admin_approval_events
  ├─< admin_execution_jobs
  └─< admin_action_audit

admin_execution_jobs
  ├─< admin_execution_attempts
  └─< admin_action_audit
```

## 8. 与现有第一期 API 的映射

### 8.1 `POST /api/admin/v1/auth/login`

至少会读写：

- `admin_users`
- `admin_mfa_factors`
- `admin_sessions`
- `admin_action_audit`

### 8.2 `GET /api/admin/v1/auth/me`

至少会读：

- `admin_users`
- `admin_user_role_bindings`
- `admin_roles`
- `admin_role_permissions`
- `admin_permissions`

### 8.3 `GET /api/admin/v1/approvals`

至少会读：

- `admin_approvals`
- `admin_approval_steps`

### 8.4 `POST /api/admin/v1/approvals`

至少会写：

- `admin_approvals`
- `admin_approval_steps`
- `admin_approval_events`
- `admin_action_audit`

### 8.5 `POST /api/admin/v1/approvals/{approvalId}/decision`

至少会写：

- `admin_approval_steps`
- `admin_approval_events`
- `admin_approvals`
- `admin_execution_jobs`
- `admin_action_audit`

## 9. 首期建表优先级

如果要按最短交付路径推进，建议顺序如下：

1. `admin_users`
2. `admin_mfa_factors`
3. `admin_sessions`
4. `admin_roles`
5. `admin_permissions`
6. `admin_role_permissions`
7. `admin_user_role_bindings`
8. `admin_approvals`
9. `admin_approval_steps`
10. `admin_approval_events`
11. `admin_execution_jobs`
12. `admin_execution_attempts`
13. `admin_action_audit`
14. `admin_audit_exports`

严格说一期最少也要把前 12 张表搞定，不然审批流和审计链不完整。

## 10. 最终建议

1. `gateway-admin` 必须有自己的控制面数据库，不要继续拿交易域表硬凑后台能力。
2. 后台只拥有“身份、权限、审批、执行、审计”真相，不拥有资金账本真相。
3. 审批主表、审批步骤表、执行任务表、后台审计表，这四根柱子必须同时存在，缺一根都不算生产级控制面。
4. Dashboard 一期不要急着建自己的交易镜像表，先走受控只读聚合，避免双写灾难。
5. 真正涉及补账、提现、退款放行时，`admin` 表里只存审批链和执行链，最终资金结果仍以 `gateway` 为准。
