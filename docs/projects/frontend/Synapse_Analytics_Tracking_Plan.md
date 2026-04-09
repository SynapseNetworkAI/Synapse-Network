# Synapse Network Analytics Tracking Plan

- Status: proposed
- Code paths: `apps/frontend/`, `gateway/`, `provider_service/`, `sdk/python/`, `contracts/`, `admin/gateway-admin/`
- Source inputs: `roles/cro_optimizer/outputs/tracking-plan.md`, Synapse product context, current `docs/projects/*` boundaries
- Last updated: 2026-04-09

本文给 Synapse Network 一套可直接落地的增长与产品埋点设计，目标不是“多采集数据”，而是回答四个经营问题：

1. 流量从哪里来，哪里转化掉了。
2. Consumer 从访问到首充、首调、复用的激活链路哪里最卡。
3. Provider 从注册到上架、首单、首次结算哪里最卡。
4. 失败、风控、余额不足、Provider 健康问题分别在吞掉哪一步转化。

---

## 1. 建议的度量栈

结论先行：

1. **PostHog 作为产品分析主系统**：承接 funnel、retention、cohort、session replay。
2. **GA4 作为流量归因系统**：承接 landing、campaign、UTM、SEO / AI SEO 来源分析。
3. **Server-side event pipeline 作为计费真相层**：由 `gateway/`、`provider_service/`、链上确认监听写入 PostHog。

不建议把关键收入或调用成功事件只放在前端埋点里。`deposit_completed`、`invoke_completed`、`provider_first_revenue_received`、`settlement_claimed` 必须以服务端为准。

---

## 2. 埋点范围

### 2.1 Consumer 主漏斗

```text
Landing visit
-> wallet connected
-> consumer signup completed
-> deposit started
-> deposit completed
-> credential created
-> service discovered
-> invoke completed
-> repeat invoke completed
```

### 2.2 Provider 主漏斗

```text
Landing visit
-> wallet connected
-> provider signup completed
-> provider secret created
-> service manifest completed
-> service registered
-> first paid call received
-> first settlement claimed
```

### 2.3 运维与商业质量面

```text
quote generated
-> invoke accepted / rejected
-> settlement recorded
-> refund issued
-> withdrawal requested / completed
-> provider health degraded
```

---

## 3. 统一命名规范

### 3.1 事件名

全部使用 `object_action`：

- `wallet_connected`
- `deposit_completed`
- `service_registered`
- `invoke_failed`

规则：

1. 全小写，下划线分隔。
2. 已完成动作用过去式：`completed` / `failed` / `requested`。
3. 不把页面位置写进事件名，页面位置放到属性里。
4. 同一业务动作不要做前后端双份不同命名。

### 3.2 公共属性

所有事件尽量带上以下字段：

| Property | Meaning |
|---|---|
| `distinct_id` | 匿名 id 或钱包 hash |
| `role` | `consumer` / `provider` / `anonymous` |
| `page_path` | 当前页面路径 |
| `surface` | `landing` / `console` / `sdk` / `provider_console` / `gateway_api` |
| `utm_source` | 流量来源 |
| `utm_medium` | 渠道类型 |
| `utm_campaign` | 活动标识 |
| `session_id` | 会话 id |
| `env` | `local` / `staging` / `prod` |
| `chain_id` | 链 id |
| `wallet_provider` | 钱包类型 |

### 3.3 业务属性补充

按业务补充，不要所有事件都塞：

| Scenario | Required properties |
|---|---|
| Deposit | `amount_usdc`, `token_symbol`, `tx_hash`, `time_to_confirm_ms` |
| Invoke | `service_id`, `provider_id`, `quote_id`, `price_usdc`, `latency_ms`, `error_code` |
| Provider listing | `service_id`, `pricing_model`, `price_usdc`, `manifest_version` |
| Settlement | `gross_usdc`, `platform_fee_usdc`, `provider_net_usdc` |

---

## 4. 身份与隐私策略

### 4.1 身份拼接

```text
anonymous_id
-> wallet_connected
-> identify(wallet_address_hash)
-> attach role / balance tier / service counts
```

### 4.2 约束

1. 不在 analytics 系统存储原始钱包地址，统一使用 `sha256(wallet_address)`。
2. 不发送邮箱、手机号、签名原文、完整请求 payload。
3. 金额类字段只存 Synapse 业务必需值，例如 `amount_usdc`、`platform_fee_usdc`。
4. 账本真相、审计证据仍以 gateway / contracts / admin projection 为准，analytics 只做行为分析。

---

## 5. 事件总表

## 5.1 Shared acquisition + identity

| Event | Source | Trigger | Required properties | Purpose |
|---|---|---|---|---|
| `page_viewed` | `apps/frontend/` | 首次访问或 SPA 路由变化 | `page_path`, `page_title`, `referrer`, `utm_*` | 看页面流量与入口质量 |
| `cta_clicked` | `apps/frontend/` | 任一核心 CTA 点击 | `cta_id`, `cta_text`, `cta_location`, `page_path` | 看 CTA 位点转化 |
| `wallet_connect_started` | `apps/frontend/` | 点击连接钱包 | `wallet_provider`, `page_path` | 看钱包入口摩擦 |
| `wallet_connected` | `apps/frontend/` | 钱包连接并完成签名 | `wallet_provider`, `chain_id`, `is_new_user` | 看注册起点 |
| `wallet_connect_failed` | `apps/frontend/` | 用户拒签或网络异常 | `wallet_provider`, `error_code` | 看失败原因 |
| `role_selected` | `apps/frontend/` | 选择 consumer/provider | `role`, `page_path` | 看用户意图分流 |

## 5.2 Consumer activation

| Event | Source | Trigger | Required properties | Purpose |
|---|---|---|---|---|
| `consumer_signup_completed` | `apps/frontend/` + `gateway/` | Consumer 身份创建完成 | `wallet_provider`, `chain_id` | 看 visit -> signup |
| `consumer_console_viewed` | `apps/frontend/` | 首次进入 owner / consumer 控制台 | `time_since_signup_ms` | 看 time-to-console |
| `deposit_started` | `apps/frontend/` | 点击充值并提交金额 | `amount_usdc`, `token_symbol`, `chain_id` | 看充值意图 |
| `deposit_permit_signed` | `apps/frontend/` | Permit 成功 | `amount_usdc`, `token_symbol` | 看 permit 摩擦 |
| `deposit_completed` | `gateway/` or chain listener | 充值确认并入账 | `amount_usdc`, `token_symbol`, `tx_hash`, `time_to_confirm_ms` | 看首充转化 |
| `deposit_failed` | `gateway/` | 充值失败 / 超时 / 回滚 | `amount_usdc`, `error_code` | 看首充失败原因 |
| `voucher_redeemed` | `gateway/` | 代金券兑换成功 | `voucher_type`, `credit_usdc` | 看 promo 有效性 |
| `credential_created` | `gateway/` + `apps/frontend/` | API credential 创建成功 | `scope`, `budget_enabled`, `budget_usdc` | 看调用前激活门槛 |

## 5.3 Discovery + invoke

| Event | Source | Trigger | Required properties | Purpose |
|---|---|---|---|---|
| `service_search_executed` | `apps/frontend/`, `sdk/python/` | 搜索服务 | `query`, `results_count`, `surface` | 看发现效率 |
| `service_detail_viewed` | `apps/frontend/`, `sdk/python/` | 打开服务详情 | `service_id`, `provider_id`, `price_usdc` | 看服务兴趣 |
| `quote_generated` | `gateway/` | 返回报价成功 | `service_id`, `quote_id`, `price_usdc` | 看调用前意图 |
| `invoke_started` | `apps/frontend/`, `sdk/python/`, `gateway/` | 用户或 SDK 发起调用 | `service_id`, `provider_id`, `quote_id`, `surface` | 看调用意图规模 |
| `invoke_completed` | `gateway/` | 调用成功并完成计费 | `service_id`, `provider_id`, `quote_id`, `price_usdc`, `latency_ms`, `is_first_invoke` | 看 activation 与服务质量 |
| `invoke_failed` | `gateway/` | 调用失败 | `service_id`, `provider_id`, `quote_id`, `error_code`, `failure_stage` | 看失败根因 |
| `budget_blocked` | `gateway/` | 因预算或余额不足被拦截 | `service_id`, `required_usdc`, `available_usdc`, `error_code` | 看预算门槛是否过紧 |
| `receipt_viewed` | `apps/frontend/` | 查看调用收据 | `receipt_id`, `service_id` | 看计费透明度是否被使用 |

## 5.4 Provider activation

| Event | Source | Trigger | Required properties | Purpose |
|---|---|---|---|---|
| `provider_signup_completed` | `apps/frontend/` or provider surface | Provider 身份创建完成 | `wallet_provider`, `chain_id` | 看 provider 注册 |
| `provider_console_viewed` | provider surface | 首次进入 provider 控制台 | `time_since_signup_ms` | 看 time-to-console |
| `provider_secret_created` | `provider_service/` | 签名 secret 创建成功 | `is_first_secret` | 看 prerequisite 完成率 |
| `service_manifest_step_completed` | provider surface | 完成 manifest 某一步 | `step_name`, `step_number` | 找出配置流失点 |
| `service_registered` | `provider_service/` + `gateway/` | 服务上架成功 | `service_id`, `pricing_model`, `price_usdc`, `manifest_version` | 看 listing CVR |
| `service_register_failed` | `provider_service/` | 上架失败 | `error_code`, `error_field` | 看 provider 失败原因 |
| `service_status_changed` | `provider_service/` | 激活/停用服务 | `service_id`, `new_status` | 看库存活跃度 |

## 5.5 Provider revenue + settlement

| Event | Source | Trigger | Required properties | Purpose |
|---|---|---|---|---|
| `provider_first_revenue_received` | `gateway/` | 某 provider 第一次收到付费调用 | `provider_id`, `service_id`, `gross_usdc`, `time_since_listing_ms` | 看 time-to-first-value |
| `provider_revenue_received` | `gateway/` | 任一付费调用结算 | `provider_id`, `service_id`, `gross_usdc`, `platform_fee_usdc`, `provider_net_usdc` | 看供给侧收入 |
| `settlement_claim_requested` | `provider_service/` or `gateway/` | 发起提现 / claim | `provider_id`, `claim_usdc` | 看提现意图 |
| `settlement_claim_completed` | `gateway/` + chain listener | claim 成功 | `provider_id`, `claim_usdc`, `tx_hash`, `time_to_confirm_ms` | 看收益兑现 |
| `settlement_claim_failed` | `gateway/` | claim 失败 | `provider_id`, `claim_usdc`, `error_code` | 看收益兑现问题 |
| `provider_health_degraded` | `gateway/` or `provider_service/` | 健康检查连续失败 | `provider_id`, `service_id`, `failure_count`, `reason` | 看供给侧质量风险 |

## 5.6 Money movement + safety

| Event | Source | Trigger | Required properties | Purpose |
|---|---|---|---|---|
| `withdrawal_requested` | `apps/frontend/`, `gateway/` | 用户提交提现 | `amount_usdc`, `role` | 看出金意图 |
| `withdrawal_completed` | `gateway/` + chain listener | 提现完成 | `amount_usdc`, `tx_hash`, `time_to_confirm_ms`, `role` | 看资金闭环 |
| `withdrawal_failed` | `gateway/` | 提现失败 | `amount_usdc`, `error_code`, `role` | 看失败点 |
| `refund_completed` | `gateway/` | 退款完成 | `amount_usdc`, `reason_code`, `service_id` | 看质量与风控成本 |
| `risk_rule_triggered` | `gateway/` | 命中风控规则 | `rule_code`, `surface`, `severity` | 看安全摩擦与误伤 |

---

## 6. Funnel 定义

## 6.1 Consumer activation funnel

```text
page_viewed (landing)
-> wallet_connected
-> consumer_signup_completed
-> deposit_completed
-> credential_created
-> invoke_completed { is_first_invoke: true }
```

核心指标：

1. `landing_to_signup_cvr`
2. `signup_to_first_deposit_cvr`
3. `deposit_to_first_invoke_cvr`
4. `median_time_to_first_invoke`
5. `budget_block_rate_before_first_invoke`

## 6.2 Provider activation funnel

```text
page_viewed (provider entry)
-> wallet_connected
-> provider_signup_completed
-> provider_secret_created
-> service_registered
-> provider_first_revenue_received
```

核心指标：

1. `provider_signup_cvr`
2. `signup_to_listing_cvr`
3. `listing_to_first_revenue_cvr`
4. `median_time_to_first_revenue`
5. `service_register_failure_rate`

## 6.3 Reliability funnel

```text
quote_generated
-> invoke_started
-> invoke_completed
-> provider_revenue_received
```

核心指标：

1. `quote_to_invoke_start_rate`
2. `invoke_success_rate`
3. `invoke_settlement_success_rate`
4. `provider_health_degraded_rate`

---

## 7. Dashboard 设计

## 7.1 Growth dashboard

回答“渠道和页面是否把人送进首调”：

1. Landing UV by `utm_source / utm_campaign`
2. CTA CTR by `cta_location`
3. Wallet connect success rate
4. Consumer signup CVR
5. Provider signup CVR
6. Top landing pages by first invoke conversion

## 7.2 Consumer activation dashboard

回答“为什么用户没走到首调”：

1. Deposit completion rate
2. First invoke completion rate
3. Median time from signup -> deposit -> first invoke
4. Budget blocked rate
5. Top failed `invoke_failed.error_code`

## 7.3 Provider marketplace dashboard

回答“为什么供给没起量”：

1. New providers
2. Services registered
3. Time to first paid call
4. Provider health degraded count
5. Active providers with revenue in last 7 days

## 7.4 Revenue quality dashboard

回答“增长是否真的产生可结算收入”：

1. Daily successful invokes
2. GMV in USDC
3. Platform fee USDC
4. Provider net USDC
5. Refund rate
6. Withdrawal completion rate

---

## 8. 告警设计

| Alert | Condition | Owner |
|---|---|---|
| Signup drop | `consumer_signup_completed` or `provider_signup_completed` < 7-day avg * 0.5 | Growth |
| Deposit failure spike | `deposit_failed / deposit_started > 0.15` in 1h | Gateway |
| Invoke error spike | `invoke_failed / invoke_started > 0.1` in 30m | Gateway |
| Provider listing outage | `service_registered = 0` in 24h | Provider |
| Settlement claim failure spike | `settlement_claim_failed / settlement_claim_requested > 0.1` in 1h | Gateway |
| Health degradation spike | `provider_health_degraded` > threshold by service/provider | Provider ops |

---

## 9. 实施映射

## 9.1 `apps/frontend/`

前端负责：

1. acquisition events
2. wallet connect events
3. deposit started / permit signed
4. service browse / detail / receipt viewed
5. 统一采集 `utm_*`, `page_path`, `surface`

建议做法：

1. 建一个 `lib/analytics.ts` 统一封装 `capture()`, `identify()`, `page()`
2. 页面只传业务字段，不直连第三方 SDK
3. 每次路由变化统一触发 `page_viewed`

## 9.2 `gateway/`

服务端必须采：

1. `deposit_completed`
2. `deposit_failed`
3. `quote_generated`
4. `invoke_started`
5. `invoke_completed`
6. `invoke_failed`
7. `budget_blocked`
8. `provider_revenue_received`
9. `withdrawal_completed`
10. `refund_completed`
11. `risk_rule_triggered`

原则：

1. 用 request-scoped correlation id 串起 quote / invoke / settlement。
2. 所有收入与失败事件由 gateway 作为 source of truth。
3. 同一调用只允许一条最终态：`invoke_completed` 或 `invoke_failed`。

## 9.3 `provider_service/`

负责：

1. `provider_secret_created`
2. `service_manifest_step_completed`
3. `service_registered`
4. `service_register_failed`
5. `service_status_changed`
6. `settlement_claim_requested`

## 9.4 `sdk/python/`

负责补齐“纯 SDK 用户不经过前端”的行为：

1. `service_search_executed`
2. `service_detail_viewed` 可以用 `service_selected` 语义替代
3. `invoke_started`

SDK 侧不要上报最终计费成功态，最终成功态仍由 gateway 上报，避免双写冲突。

## 9.5 `contracts/`

链上确认监听负责补强：

1. `deposit_completed`
2. `settlement_claim_completed`
3. `withdrawal_completed`

如果 gateway 已有最终确认回写逻辑，链上监听只负责校验与补偿，不要重复发事件。

---

## 10. UTM 规范

统一使用：

| Param | Example |
|---|---|
| `utm_source` | `producthunt`, `hackernews`, `x`, `github`, `docs` |
| `utm_medium` | `social`, `community`, `referral`, `email`, `organic` |
| `utm_campaign` | `launch_day`, `provider_outreach_q2`, `docs_cta` |
| `utm_content` | `hero_cta`, `sidebar_link`, `thread_v2` |

推荐必须打 UTM 的入口：

1. 官网 hero CTA
2. GitHub README CTA
3. docs 内 dashboard / signup 链接
4. Product Hunt / HN / X 发帖
5. provider outreach 邮件链接

---

## 11. 实施顺序

### Phase 1

先落最小可用闭环：

1. `page_viewed`
2. `cta_clicked`
3. `wallet_connected`
4. `consumer_signup_completed`
5. `provider_signup_completed`
6. `deposit_completed`
7. `invoke_completed`
8. `service_registered`
9. `provider_first_revenue_received`

### Phase 2

补优化诊断：

1. `wallet_connect_failed`
2. `deposit_failed`
3. `invoke_failed`
4. `budget_blocked`
5. `service_register_failed`
6. `provider_health_degraded`

### Phase 3

补商业质量与资金闭环：

1. `provider_revenue_received`
2. `settlement_claim_completed`
3. `withdrawal_completed`
4. `refund_completed`
5. `risk_rule_triggered`

---

## 12. 上线验收清单

上线前必须逐条验证：

1. 同一动作不会重复上报。
2. 钱包地址已 hash。
3. `utm_*` 能从 landing 传到 signup 与 first invoke。
4. `invoke_completed` 和收入类事件只由 gateway 写最终态。
5. dashboard 能按 `role`, `surface`, `utm_source` 切分。
6. provider 与 consumer 漏斗都能在 PostHog 里直接搭出来。

最终标准不是“事件数量够多”，而是下面 5 个问题可以在 5 分钟内回答：

1. 今天流量主要来自哪里。
2. Consumer 最大 drop-off 在哪一步。
3. Provider 最大 drop-off 在哪一步。
4. 调用失败主要因为什么。
5. 成功调用有没有稳定转成平台费和 provider 净收入。
