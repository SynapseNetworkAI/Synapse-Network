# gateway-admin MFA 绑定流程设计

## 1. 结论先说

当前 `gateway-admin` 已经支持完整的“密码登录 -> 检测必须补绑 MFA -> 发放短时 enrollment token -> 返回二维码/手工 key -> 首次验证码确认 -> 建立正式后台会话”流程。

当前判断逻辑可以概括为三条：

1. `admin_users.require_mfa = true` 只代表账号策略上要求 MFA，不代表账号已经完成绑定。
2. 只有当账号存在且仅存在一条 `admin_mfa_factors.factor_type = 'totp'` 且 `status = 'active'` 的因子时，登录页才应该要求直接输入 OTP。
3. 当密码正确、`require_mfa = true` 且当前账号没有 active TOTP factor 时，登录接口会返回 `428 MFA_ENROLLMENT_REQUIRED`，前端应进入绑定流程页而不是展示“Invalid admin credentials”。

本地 bootstrap 管理员还要额外注意两点：

1. seed 数据默认已经写入 active TOTP factor，所以它们不是“未绑定 MFA”的测试样本。
2. seed 数据默认不带 `password_hash`，如果没先初始化密码，会在第一步就返回 `Invalid admin credentials`，也不会进入补绑分支。

## 2. 当前实现现状

### 2.1 数据库层

当前 admin bootstrap SQL 已经有 `admin_mfa_factors` 表，字段足够表达一个 TOTP 因子的基本状态：

- `factor_id`
- `admin_id`
- `factor_type`
- `factor_label`
- `status`
- `secret_ref`
- `payload_json`
- `last_verified_at`
- `created_at` / `updated_at` / `revoked_at`

其中：

- `factor_type` 已支持 `totp / webauthn / backup_code`
- `status` 已支持 `pending / active / revoked`

这说明 schema 不是空白状态，TOTP 因子的持久化边界已经有了。

### 2.2 登录校验层

当前登录服务会这样处理：

1. 先校验 `email + password`
2. 如果管理员 `require_mfa = false`，直接跳过 OTP 校验
3. 如果 `require_mfa = true`，则读取该管理员的 active TOTP factor
4. 当 `ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=true` 时，要求前端传 `otpCode`
5. OTP 正确才创建 admin session cookie

这条链路的关键事实是：

- 已绑定且启用了 MFA 的账号，当前可以走 Google Authenticator 登录
- 未绑定但 `require_mfa = true` 的账号，会收到 `428 MFA_ENROLLMENT_REQUIRED`
- 前端随后调用 `POST /api/admin/v1/auth/mfa/enroll/begin` 和 `POST /api/admin/v1/auth/mfa/enroll/verify` 完成首次绑定

### 2.3 当前缺失项

当前系统已经落地首次 enrollment flow，但仍有后续增强空间：

- 还没有 `rebind / rotate factor` API
- 还没有 backup code 配套流程
- 还没有设备管理页与解绑审计界面

## 3. “密码对了但没绑 MFA，弹出绑定 MFA” 合不合理

合理，但只能在严格约束下成立。

### 3.1 合理的前提

这个流程只适合以下场景：

- bootstrap 管理员首次登录
- 被 `super_admin` 创建的新管理员首次激活
- 原账号被要求补齐 MFA 后才能继续使用控制面

这类流程的产品目标不是“放松登录要求”，而是“完成一次受控 enrollment 后，才发正式后台会话”。

### 3.2 不合理的做法

下面这种做法不行：

- 密码对了，先直接发完整 admin session cookie
- 前端再弹窗要求用户补绑 MFA
- 用户即使不绑，也已经拿到了后台控制面权限

这会直接击穿控制面安全边界，属于架构警报。

### 3.3 正确做法

正确做法应该是：

1. 用户密码验证成功
2. 服务端发现账号要求 MFA，但没有 active TOTP factor
3. 服务端不发正式 admin session
4. 服务端返回 `MFA_ENROLLMENT_REQUIRED`
5. 只发一个短时效、低权限、一次性的 enrollment challenge
6. 用户完成 Google Authenticator 绑定并提交首个 6 位验证码
7. 服务端验证通过后，把 factor 标记为 `active`
8. 然后才发正式 admin session cookie

这套流程才叫“先绑定，再放行”，而不是“先放行，再补票”。

## 4. 推荐目标状态

### 4.1 交互目标

当管理员输入正确账号密码后，系统分三种情况：

#### 情况 A：账号不要求 MFA

- 正常登录成功
- 返回正式 session cookie

#### 情况 B：账号要求 MFA，且已有 active factor

- 要求输入 `otpCode`
- 校验通过后返回正式 session cookie

#### 情况 C：账号要求 MFA，但还没有 active factor

- 不返回正式 session
- 返回 `MFA_ENROLLMENT_REQUIRED`
- 前端跳转到 “Bind Google Authenticator” 流程页

## 5. 推荐状态机

### 5.1 AdminUser 维度

- `require_mfa = false`：账号允许无 MFA 登录
- `require_mfa = true`：账号必须通过 MFA 才能拿到正式后台会话

### 5.2 AdminMfaFactor 维度

- `pending`：已发起绑定，但还没有完成首个 OTP 验证
- `active`：已绑定成功，可用于登录与高风险 step-up
- `revoked`：已废弃，不再允许使用

### 5.3 Enrollment Challenge 维度

建议新增独立 challenge 状态，而不是复用正式 session：

- `issued`
- `verified`
- `expired`
- `cancelled`

## 6. 推荐后端接口

### 6.1 `POST /api/admin/v1/auth/login`

#### 输入

- `email`
- `password`
- `otpCode` 可选

#### 返回分支

##### 登录成功

- `200 OK`
- 下发正式 session cookie

##### 需要补绑 MFA

- `428 Precondition Required` 或 `403 Forbidden`
- 错误码：`MFA_ENROLLMENT_REQUIRED`
- data 内返回：
  - `enrollmentToken`
  - `expiresIn`
  - `maskedEmail`
  - `totpIssuer`

##### MFA 已启用但 OTP 错误

- `401 Unauthorized`
- 错误码：`INVALID_MFA_CODE`

### 6.2 `POST /api/admin/v1/auth/mfa/enroll/begin`

作用：

- 校验 enrollment token
- 生成一份新的 TOTP secret
- 创建或覆盖一条 `admin_mfa_factors.status = pending` 的记录
- 返回前端展示二维码所需信息

返回字段建议：

- `factorId`
- `issuer`
- `accountName`
- `otpauthUrl`
- `manualEntryKey`
- `expiresIn`

### 6.3 `POST /api/admin/v1/auth/mfa/enroll/verify`

- 新因子验证成功后，服务端会把该 TOTP 因子提升为唯一 active 因子。
- 同一管理员名下其他 `pending` 或 `active` 的 TOTP 因子会被立即回收为 `revoked`，避免出现多个 active secret 并存。
- 如果库中已经出现多个 active TOTP 因子这类脏状态，登录 OTP 与高风险 step-up OTP 都会拒绝继续执行，直到运维清理或管理员重新绑定。

作用：

- 用用户输入的 6 位 OTP 校验 pending factor
- 校验通过后把 factor 置为 `active`
- 记录 `last_verified_at`
- 废弃同 admin 下其他 pending factor
- 然后下发正式 session cookie

输入字段建议：

- `enrollmentToken`
- `factorId`
- `otpCode`

### 6.4 `POST /api/admin/v1/auth/mfa/rebind/begin`

作用：

- 已登录管理员更换设备时发起重新绑定
- 必须要求：
  - 当前 session 有效
  - 通过高风险 OTP step-up
  - 记录审计日志

### 6.5 `POST /api/admin/v1/auth/mfa/rebind/confirm`

作用：

- 新设备 OTP 验证成功后
- 新 factor `active`
- 旧 factor `revoked`

## 7. 推荐数据库设计调整

## 7.1 现有表可继续复用

`admin_mfa_factors` 不需要推翻重做，足够作为 MFA 因子主表。

建议保留：

- `status = pending / active / revoked`
- `factor_type = totp`
- `last_verified_at`

## 7.2 建议新增表：`admin_mfa_enrollment_challenges`

原因：

- “密码已过但尚未正式登录”的状态，不应该塞进正式 `admin_sessions`
- enrollment challenge 和 admin session 的安全等级、用途、生命周期完全不同

建议字段：

- `challenge_id`
- `admin_id`
- `challenge_token_hash`
- `status`
- `expires_at`
- `issued_at`
- `verified_at`
- `client_ip`
- `user_agent`
- `request_id`

## 7.3 关于 secret 存储

生产环境不建议继续把明文 `totpSecret` 直接塞在 `payload_json` 里。

推荐改成：

- `secret_ref` 指向 KMS / Secret Manager / Vault
- `payload_json` 只保留非敏感元信息，例如：
  - `issuer`
  - `maskedSecret`
  - `enrolledAt`
  - `deviceLabel`

本地 demo 或 seed 环境可以保留简化实现，但生产不能把静态 TOTP secret 当常态方案。

## 8. 推荐前端流程

### 8.1 登录页阶段

1. 用户输入邮箱密码
2. 调用 `/auth/login`
3. 如果返回 `MFA_ENROLLMENT_REQUIRED`
4. 跳转 `/login/mfa-enroll`

### 8.2 MFA 绑定页阶段

页面展示：

- 二维码
- 手工录入 key
- 风险提示
- 6 位验证码输入框

用户动作：

1. 在 Google Authenticator 里扫码或手工录入
2. 输入当前 6 位验证码
3. 提交 `/auth/mfa/enroll/verify`
4. 验证成功后进入 dashboard

### 8.3 失败场景

- enrollment token 过期：要求重新登录
- OTP 连续输错过多：challenge 失效并审计
- 二维码泄漏怀疑：允许取消当前 pending factor 并重新 begin

## 9. 审计要求

MFA 绑定不是普通 UI 行为，必须写审计。

至少记录以下事件：

- `admin.mfa.enroll.required`
- `admin.mfa.enroll.begin`
- `admin.mfa.enroll.verify.success`
- `admin.mfa.enroll.verify.failure`
- `admin.mfa.rebind.begin`
- `admin.mfa.rebind.success`
- `admin.mfa.rebind.revoke_old_factor`

审计字段至少包含：

- `admin_id`
- `email`
- `request_id`
- `client_ip`
- `user_agent`
- `factor_id`
- `result_status`
- `error_code`

## 10. 风险边界

### 10.1 不能做的事

- 不能在密码通过后直接发完整 session，再让前端慢慢绑定 MFA
- 不能把 enrollment token 当长期 token
- 不能允许 pending factor 直接参与高风险 step-up
- 不能在生产默认 seed 一个全体通用的静态 TOTP secret

### 10.2 必须做的事

- enrollment token 短时效
- enrollment challenge 一次性消费
- OTP 验证失败要限次
- rebind 必须要求当前已登录 + 高风险二次验证
- secret 存储与展示分离

## 11. 实施建议

建议按两期做，不要一口气把安全改造和 UI 全堆在一个 PR 里。

### Phase 1

- 新增 `admin_mfa_enrollment_challenges`
- 登录接口支持返回 `MFA_ENROLLMENT_REQUIRED`
- 新增 `enroll/begin` 与 `enroll/verify`
- admin-front 增加绑定页

### Phase 2

- 支持 rebind / revoke / recovery code
- secret_ref 接 KMS
- 审计与风控限次加强

## 12. 最终判断

### 当前数据库 SQL 支不支持 Google MFA 登录？

支持已绑定账号的 Google MFA 登录。

### 当前数据库 SQL 支不支持完整的 MFA 首绑流程？

不完整。能存因子，但缺 enrollment challenge 和正式绑定 API 流程。

### “密码对了但没绑 MFA，就弹出绑定 MFA” 合不合理？

合理，但前提是：

- 不能先发正式 session
- 必须走受限 enrollment challenge
- 绑定成功后才允许进入后台控制面

这才是金融级控制面的正确姿势。