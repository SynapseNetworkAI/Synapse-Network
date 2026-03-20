# Admin 与 Gateway 安全方案设计

本文回答四个问题：

1. 现在审批动作是不是会调用 gateway
2. 当前实现有没有安全问题
3. 生产级安全方案应该是什么
4. 如何同时保证 `gateway` 和 `admin` 两个平面的安全

结论先行：

1. **是的，当前审批/执行类动作会由 `gateway-admin` 以服务端代理方式调用 `gateway`。不是浏览器直连 `gateway`。**
2. **当前方案能支撑内网开发与受控环境联调，但还不是金融级生产终态。**
3. 当前最大安全债不是“有没有鉴权”，而是：**`admin -> gateway` 仍然复用了 wallet-subject JWT 语义和共享 secret 模式，服务身份、用户身份、内部命令身份还没彻底拆开。**
4. **当前代码已完成第一阶段硬化：`gateway-admin -> gateway` 内部命令已经切到独立 `service principal + scope + body digest + jti replay guard`。下一阶段重点是浏览器 session 和网络隔离。**

## 1. 当前真实调用链

目前 Provider withdrawal manual review / approval 相关动作的真实调用链是：

```text
admin-front (browser)
  -> gateway-admin (/api/admin/v1/...)
  -> gateway-admin service adapter
  -> gateway (/api/v1/admin/providers/withdrawals/{withdrawalId}/review)
  -> gateway finance service / ledger mutation
```

也就是说：

1. 浏览器只拿 `gateway-admin` 的 admin token，不直接访问 `gateway` 管理命令。
2. `gateway-admin` 读取 gateway 的只读投影库做总览查询。
3. 真正涉及资金状态推进时，由 `gateway-admin` 通过内部 HTTP adapter 代调用 `gateway`。

当前代码证据：

1. `gateway-admin` 的 review adapter 会向 gateway 发起内部 HTTP 请求，并附带 `Authorization`、`X-User-Address`、`X-Request-Id`：[admin/gateway-admin/src/services/adapters/provider_withdraw_review.py](./../../admin/gateway-admin/src/services/adapters/provider_withdraw_review.py)
2. `gateway-admin` 的依赖注入明确把 review/execute adapter 指向 `GATEWAY_INTERNAL_BASE_URL`：[admin/gateway-admin/src/api/deps.py](./../../admin/gateway-admin/src/api/deps.py)
3. `gateway` 上对应的 review 管理接口是 `/api/v1/admin/providers/withdrawals/{withdrawal_id}/review`：[gateway/src/api/routers/balance.py](./../../gateway/src/api/routers/balance.py)

## 2. 当前已经具备的安全控制

当前实现并不是完全裸奔，已经有三层基本防线。

### 2.1 Admin 自身有独立身份体系

`admin-front` 和 `gateway-admin` 使用独立的后台管理员身份体系，而不是直接复用普通 owner / provider 的登录态。

已有控制：

1. `gateway-admin` 自己维护 `admin session`，不是直接吃 gateway 用户 token：[admin/gateway-admin/src/services/auth/service.py](./../../admin/gateway-admin/src/services/auth/service.py)
2. 后台接口按 `approval:read`、`approval:decide` 等 permission 做 RBAC 检查：[admin/gateway-admin/src/api/deps.py](./../../admin/gateway-admin/src/api/deps.py)
3. provider withdrawal review 的 admin 决策会写 `admin_action_audit`：[admin/gateway-admin/src/services/finance_admin/provider_withdraw_review_service.py](./../../admin/gateway-admin/src/services/finance_admin/provider_withdraw_review_service.py)

### 2.2 Admin 对 Gateway 的读写边界已初步分离

已有控制：

1. 只读查询走 `GATEWAY_READONLY_DSN`。
2. 真正资金推进不直接写 gateway 表，而是回到 `gateway` 服务执行命令。
3. 这避免了 `gateway-admin` 直接拿写库权限去改资金真相表。

### 2.3 Gateway 管理命令不是对任意钱包开放

已有控制：

1. `gateway` 会先从 Bearer token 解出 `sub`，再和 `X-User-Address` 做 wallet mismatch 校验：[gateway/src/services/platform/credential_service.py](./../../gateway/src/services/platform/credential_service.py)
2. 管理命令还会额外检查该钱包是否在 `PLATFORM_FEE_ADMIN_WALLETS` allow-list 中：[gateway/src/api/routers/balance.py](./../../gateway/src/api/routers/balance.py)
3. 手工审核动作最终仍按 `owner + withdrawal_id` 在 gateway 内部查单，不是只靠前端传参盲改：[gateway/src/services/provider/withdraw_service.py](./../../gateway/src/services/provider/withdraw_service.py)

## 3. 当前方案的安全问题

兄弟，重点来了。**现在不是没有安全，而是“安全域划分还不够彻底”。** 这套方案放 staging 没问题，放生产资金面就得继续升级。

### 3.1 最大问题：内部服务调用仍复用 gateway 的用户 JWT 模型

当前 `gateway-admin` 调用 `gateway` 时，会自己签一个 HS256 token，claim 只有：

1. `sub`
2. `role`
3. `iat`
4. `exp`

而 `gateway` 的 `require_owner_wallet(...)` 实际主要只验证：

1. token 能不能用 `JWT_SECRET` 解开
2. `sub` 是不是合法钱包地址
3. `X-User-Address` 是否和 `sub` 一致

问题在于：

1. **内部服务身份和外部 owner 身份共用了同一套 wallet-subject 语义。**
2. **一旦 shared secret 泄露，攻击者可以伪造任意钱包 subject 的 gateway token。**
3. `role=admin` 这个 claim 目前不是硬性授权依据，真正授权靠的是钱包白名单。

这意味着当前模型本质上还是：

**“把内部服务伪装成一个特殊 owner wallet 去调 gateway”**

这不是终态。

### 3.2 第二个问题：没有独立的 service-to-service 信任层

当前 `admin -> gateway` 缺少以下生产级控制：

1. 没有 `aud` / `iss` / `scope` 约束
2. 没有 `jti` 防重放缓存
3. 没有请求体摘要签名或 body digest 绑定
4. 没有 mTLS
5. 没有独立 internal ingress / internal router

结果是：

1. token 只要在有效期内被截获，就存在重放窗口
2. gateway 也无法明确区分“这是 owner 自己的 token”还是“这是 gateway-admin 服务 token”

### 3.3 已完成第一步：admin-front token 已迁到 HttpOnly cookie

这部分已经完成：`gateway-admin` 登录成功后会直接下发 `HttpOnly` admin session cookie，`admin-front` 不再把 admin token 持久化到 `localStorage`。

收益：

1. 页面 JS 无法直接读取 session token，XSS 的直接 token exfiltration 风险明显下降
2. `admin-front` 所有 API 请求都统一走 `credentials: include`，浏览器不再显式拼 `Authorization` header

但这还不是终态，还剩两个必须继续补的点：

1. 当前 cookie 策略是 `SameSite=Lax`，后续高风险写操作要继续加 `CSRF` 防护
2. 生产环境必须强制 `Secure`，并结合 HTTPS / WAF / CSP 收紧浏览器面

### 3.4 第四个问题：Gateway 管理命令仍挂在主 API 面上

当前 gateway 的管理命令和交易 API 在同一个服务面里，只是 path 区分为 `/api/v1/admin/...`。

这会带来两个问题：

1. 对外暴露面仍然共享同一服务入口
2. 内部命令和外部交易入口没有做到网络面上的强隔离

正确做法应该是：

1. 公网 API 面只服务 owner / provider / agent
2. 内部命令面只服务 `gateway-admin` 或内部 orchestrator

### 3.5 第五个问题：开发态 fallback 不能带入生产认知

例如 `gateway` 某些 admin allow-list 在 development 下有 fallback 逻辑，这对本地开发友好，但不能被团队误解为生产可接受默认值。

## 4. 生产级目标架构

目标不是“把 token 再包一层”，而是要把四种身份彻底拆开。

### 4.1 四个身份平面必须独立

生产上至少要分成这四类 principal：

1. `Admin User Principal`
   真实后台管理员，例如 finance reviewer、risk reviewer
2. `Admin Session Principal`
   浏览器访问 `gateway-admin` 的后台会话
3. `Internal Service Principal`
   `gateway-admin` 调用 `gateway` 时使用的服务身份
4. `Business Subject`
   本次操作作用到的 owner/provider 钱包主体

关键原则：

1. **服务身份不等于钱包身份**
2. **操作人不等于被操作对象**
3. **浏览器会话不等于内部服务凭证**

## 5. 推荐安全方案

### 5.1 Browser -> Admin 的安全方案

#### 必须做

1. `admin-front` 不再把 access token 放在 `localStorage`
2. 改成 `Secure + HttpOnly + SameSite=Strict` cookie
3. `gateway-admin` 对写请求增加 CSRF 防护
4. 强制 HTTPS
5. 强制 MFA
6. 会话空闲超时 + 绝对过期
7. 登录、提权、审批、执行全部写审计

#### 推荐做

1. 接企业 SSO / OIDC
2. 对高风险动作增加 step-up MFA
3. 设备/IP 风险评分
4. Content-Security-Policy
5. Trusted Types / 严格禁止危险 HTML 注入

### 5.2 Admin -> Gateway 的安全方案

这是最关键的一层。

#### 目标

把今天的：

1. `shared HS256 secret`
2. `wallet-subject`
3. `allow-list`

升级成：

1. **独立 internal auth**
2. **独立 service principal**
3. **独立 internal ingress**
4. **独立 replay protection**

#### 推荐落地

1. `gateway-admin` 到 `gateway` 的调用改为独立 internal token，不复用 owner JWT
2. internal token 使用 `RS256` 或 `EdDSA`，不要继续共享对称 secret
3. gateway 只信任 `gateway-admin` 的公钥，不共享私钥
4. token 至少带这些 claim：
   - `iss=gateway-admin`
   - `aud=gateway-internal`
   - `sub=service:gateway-admin`
   - `scope=provider_withdraw.review` 或 `approval.execute`
   - `jti=<uuid>`
   - `iat`
   - `exp`，建议 60 到 120 秒
   - `actor_admin_id`
   - `actor_role`
   - `request_id`
   - `body_sha256`
5. gateway 对 `jti` 做短 TTL 防重放缓存
6. gateway 校验 `body_sha256`，防止 token 被复用到不同 payload
7. `gateway-admin` 和 `gateway` 之间加 mTLS
8. gateway internal command 只允许来自私网 ingress / service mesh / Zero Trust 网段

### 5.3 Gateway 内部命令面的安全方案

`gateway` 应新增独立 internal auth dependency，而不是继续复用 `require_owner_wallet(...)`。

#### 正确做法

新增：

1. `require_internal_service_principal(...)`
2. `require_internal_scope("provider_withdraw.review")`

由这个 dependency 负责：

1. 验证 internal token 签名
2. 校验 `iss/aud/exp/jti`
3. 校验 scope
4. 校验 body digest
5. 注入 service principal

然后业务层再接收：

1. `target_owner_address`
2. `withdrawal_id`
3. `actor_admin_id`
4. `actor_role`
5. `request_id`

也就是说，内部命令应明确表达：

**“哪个服务，以什么 scope，代表哪个 admin，对哪个业务主体执行了什么动作。”**

### 5.4 Gateway 数据与账本面的安全方案

#### 必须做

1. `gateway-admin` 对 gateway DB 只保留只读账户
2. 只读账户只能访问稳定 projection / view / analytics 读模型
3. 不允许 `gateway-admin` 直接持有 gateway 资金真相表写权限
4. 任何资金状态推进只允许走 `gateway` 服务层事务

#### 推荐做

1. 将内部命令结果与 gateway 账本审计做 request-id 级别串联
2. 对关键资金命令加幂等键
3. 对 review / complete / replay 类命令做双重唯一约束和 append-only audit

### 5.5 Secret 与 Key 管理方案

#### 必须做

1. 不再让 `GATEWAY_INTERNAL_JWT_SECRET` 和 gateway 外部 `JWT_SECRET` 复用语义
2. 生产密钥放 KMS / Vault / Secret Manager，不落 repo，不落默认 `.env`
3. 支持 key rotation
4. 日志中禁止打印 token、secret、完整 Authorization header

#### 推荐做

1. internal key 与 public user auth key 完全分离
2. 使用 `kid` 支持滚动换 key
3. 定期轮换 internal signing key

### 5.6 网络与部署方案

#### 推荐拓扑

1. `admin-front`
   - 独立域名，例如 `admin.synapse.network`
   - WAF
   - 企业 SSO
   - HTTPS only
2. `gateway-admin`
   - 不直接对公网开放，至少挂在 VPN / Zero Trust / office allow-list 后面
   - 仅开放给 `admin-front` 和运维入口
3. `gateway internal command port`
   - 私网入口
   - 只允许 `gateway-admin` 所在服务身份访问
4. `gateway public API`
   - 继续面向 owner/provider/agent
   - 不暴露 internal command route

## 6. 推荐的最小安全改造顺序

为了不打断现在的业务推进，建议按三期做。

### Phase 1：立即止血

1. admin token 从 `localStorage` 迁到 HttpOnly cookie。已完成。
2. `gateway-admin -> gateway` 内部命令改成独立 internal service token。已完成。
3. 禁止生产复用 `JWT_SECRET` 作为 internal secret。配置边界已拆开，生产密钥治理仍需落地。
4. 收紧 `PLATFORM_FEE_ADMIN_WALLETS`。待按生产环境收口。
5. 所有 internal command 都强制 request-id 审计贯通。已完成主链路。

### Phase 2：身份拆域

1. 新增 `gateway internal auth` 模块
2. 新增 `service principal` 与 scope 校验
3. 新增 `jti` 防重放
4. 新增 body digest 校验
5. gateway 管理命令改挂到 internal router

### Phase 3：金融级固化

1. mTLS
2. KMS / Vault 托管 internal signing key
3. 高危命令 step-up approval
4. 审计回放与告警联动
5. 定期做 secret rotation 和权限回顾

## 7. 审批链路的推荐最终形态

Provider manual review 的最终推荐路径应当是：

```text
Admin User
  -> admin-front (httpOnly session)
  -> gateway-admin (RBAC / approval / audit)
  -> internal signed command + mTLS
  -> gateway internal command router
  -> gateway finance service transaction
  -> gateway audit + ledger append-only evidence
```

每一步都要能回答这五个问题：

1. 谁发起的
2. 谁批准的
3. 哪个服务执行的
4. 作用到哪个 owner / withdrawal
5. request-id 和审计证据是什么

## 8. 最终结论

### 8.1 现在是不是走 gateway

是。

但不是浏览器直接调 gateway，而是：

**`admin-front -> gateway-admin -> gateway`**

### 8.2 现在有没有安全问题

有，且是典型的“架构边界还没收口”的问题，主要包括：

1. internal service auth 与 external owner auth 语义混用
2. shared secret 模式过重
3. 缺少独立 service principal / aud / scope / jti / body digest
4. 浏览器侧仍缺 `CSRF` / 更严格 cookie 策略 / CSP
5. gateway internal command 与 public API 面未完全网络隔离

### 8.3 如何保证 gateway 和 admin 的安全

核心不是多加几条 if，而是做四件事：

1. **身份拆域**：admin user、admin session、service principal、business subject 分离
2. **网络拆域**：public API、admin API、internal command 三面分离
3. **密钥拆域**：external auth key、internal signing key、session secret 分离
4. **审计闭环**：admin audit + gateway finance audit + request-id 串联

如果只做一句话总结，就是：

**Admin 负责“谁有资格发命令”，Gateway 负责“命令是否可以安全落到账本”，两边都不能互相越权。**