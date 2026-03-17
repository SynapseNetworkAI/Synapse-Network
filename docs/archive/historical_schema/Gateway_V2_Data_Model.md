# Gateway 数据库设计

> 状态更新（2026-03-17）：本文档描述的是 **当前/历史 Gateway V2 schema**，用于解释现状，不再是 build-for-agent 的目标模型。
>
> 新的 Agent Runtime 数据模型请看 [Agent_Runtime_Data_Model.md](./Agent_Runtime_Data_Model.md)，数据库重构决策请看 [docs/agent/06_Build_For_Agent_Database_Rebuild.md](../agent/06_Build_For_Agent_Database_Rebuild.md)。

本文档以当前真实 schema 为准，来源于 [infra/docker/postgres/init/001_synapse_schema.sql](../../infra/docker/postgres/init/001_synapse_schema.sql) 与 [infra/docker/postgres/init/003_gateway_admin_projection_views.sql](../../infra/docker/postgres/init/003_gateway_admin_projection_views.sql)。目标不是描述“理想模型”，而是解释 gateway 现在实际落库的表、字段、约束与职责边界。

## 1. 设计目标

Gateway 数据库承担 4 类职责：

1. 资金真相层：保存余额、充值、退款、提现、扣费与审计。
2. 路由与服务注册层：保存卖家服务清单、节点健康状态、调用配置。
3. 安全控制层：保存幂等键、去重记录、限流状态、会话与凭据。
4. 运行态与后台投影层：保存 indexer / reconciliation 状态，并向 `gateway-admin` 暴露稳定只读投影视图。

核心原则：

- 资金真相以 PostgreSQL 为准，不信任内存态。
- 金额字段统一使用 `NUMERIC`，避免 float 记账误差。
- 去重、防重放、幂等、审计都必须有物理落点。
- 后台 dashboard 不能直接散查真相表拼语义，必须走稳定读模型。

## 2. 枚举类型

### `synapse_business_type`

用途：统一标记资金业务类型。

- `deposit`: 充值
- `charge`: 调用扣费
- `refund`: 退款
- `withdraw`: 提现
- `freeze`: 冻结
- `unfreeze`: 解冻

### `synapse_risk_level`

用途：统一标记风险等级。

- `green`: 正常
- `yellow`: 需关注
- `red`: 高风险或拒绝

### `synapse_withdraw_status`

用途：提现状态机专用枚举。

- `REQUESTED`: 已申请
- `APPROVED_AUTO`: 自动批准
- `PENDING_MANUAL_REVIEW`: 待人工审核
- `REJECTED`: 已拒绝
- `COMPLETED`: 已完成

## 3. 资金与审计表

### `synapse_balances`

用途：平台链下账本余额表，是买家 / 卖家 / 平台手续费三类账户的当前余额真相。

主键与约束：

- 主键：`(owner_address, account_type)`
- `account_type` 仅允许 `buyer`、`seller`、`platform_fee`
- `available_balance`、`pending_balance`、`frozen_balance` 均不得为负数

字段说明：

- `owner_address`: 钱包地址，余额归属主体
- `account_type`: 余额账户类型
- `available_balance`: 可立即使用余额，买家可扣费，卖家可提现
- `pending_balance`: 待确认余额，典型是充值已登记但尚未最终入账，或其他待结算资金
- `frozen_balance`: 冻结余额，命中风控或人工冻结时使用
- `updated_at`: 最近一次账本更新时间

### `synapse_deposit_intents`

用途：记录充值意图和链上确认推进状态，是“链上打款”和“平台入账”之间的桥。

关键约束：

- `id` 为主键
- `tx_hash` 唯一，确保同一笔充值交易不会重复入账

字段说明：

- `id`: 充值意图 ID
- `owner_address`: 充值归属钱包地址
- `tx_hash`: 链上充值交易哈希
- `request_id`: 请求追踪 ID
- `buyer_address`: 买家钱包地址，兼容读模型和历史字段
- `amount_usdc`: 充值金额
- `idempotency_key`: 接口幂等键
- `status`: 充值状态，例如 `PENDING_CONFIRMATION`、`PENDING`、`CONFIRMED`、`FAILED`、`DUPLICATE`
- `created_at`: 创建时间
- `updated_at`: 最后更新时间

### `synapse_refund_intents`

用途：记录退款申请与完成状态，是买家退款的业务真相表。

字段说明：

- `id`: 退款意图 ID
- `owner_address`: 退款归属钱包地址
- `tx_hash`: 链上退款交易哈希，完成时写入
- `status`: 退款状态，例如 `PENDING`、`PENDING_MANUAL_REVIEW`、`COMPLETED`、`REJECTED`
- `request_id`: 请求追踪 ID
- `buyer_address`: 买家钱包地址
- `amount_usdc`: 退款金额
- `idempotency_key`: 接口幂等键
- `created_at`: 创建时间
- `updated_at`: 最后更新时间

### `synapse_withdrawal_intents`

用途：记录卖家提现申请、自动审批 / 人工审批、签名票据与最终完成状态。

字段说明：

- `id`: 提现意图 ID
- `owner_address`: 提现归属钱包地址
- `tx_hash`: 提现链上交易哈希，完成时写入
- `status`: 提现状态，使用 `synapse_withdraw_status`
- `request_id`: 请求追踪 ID
- `idempotency_key`: 幂等键
- `amount_usdc`: 人类可读 USDC 金额
- `amount_wei`: 链上最小单位金额字符串
- `fee_wei`: 提现手续费最小单位字符串
- `nonce`: EIP-712 签名 nonce
- `deadline`: 签名失效时间
- `signature`: 提现签名
- `chain_id`: 目标链 ID
- `contract_address`: 合约地址
- `signer_address`: 签名地址
- `created_at`: 创建时间
- `updated_at`: 最后更新时间

### `synapse_usage_log`

用途：记录每次 API 调用的计费流水，是 M2M 扣费的核心业务明细表。

字段说明：

- `id`: 用量日志 ID
- `ts`: 计费时间戳，毫秒级
- `request_id`: 请求 ID，用于串联幂等与链路
- `service_id`: 卖家服务 ID
- `buyer_address`: 买家钱包地址
- `seller_address`: 卖家钱包地址
- `status`: 调用状态，例如 accepted、completed、failed
- `unit_price`: 单价
- `protocol_fee`: 协议手续费
- `routing_tax`: 路由税
- `total_charge`: 总扣费金额
- `business_type`: 业务类型，默认 `charge`
- `risk_level`: 风险等级

索引重点：

- `(buyer_address, seller_address, ts DESC)` 便于按双边主体拉取最近调用
- `(request_id)` 便于按请求追踪

### `synapse_audit_log`

用途：资金级审计日志，要求 append-only，服务充值、扣费、退款、提现、冻结等关键动作的审计追溯。

字段说明：

- `id`: 审计日志主键
- `action_type`: 动作类型，例如 `V2_DEPOSIT_CONFIRMED`
- `business_type`: 业务类型枚举
- `risk_level`: 风险等级枚举
- `owner_address`: 资金归属钱包地址
- `actor`: 动作执行者，可以是系统、服务或管理员钱包
- `request_id`: 请求追踪 ID
- `trace_id`: 链路追踪 ID
- `tx_hash`: 链上交易哈希
- `counterparty_address`: 对手方钱包地址
- `direction`: 资金方向，常见为 `credit` / `debit`
- `status`: 业务状态
- `risk_reason_code`: 风控命中原因码
- `ledger_id`: 账本流水或关联记录 ID
- `client_ip`: 客户端 IP
- `user_agent`: 客户端 UA
- `amount_delta`: 本次变动金额
- `before_balance`: 变动前余额
- `after_balance`: 变动后余额
- `result_status`: 动作结果状态
- `error_code`: 错误码
- `message`: 附加说明
- `created_at`: 记录创建时间

### `synapse_system_activity_log`

用途：系统级动作审计，偏运维与控制面，不直接等同于资金流水审计。

字段说明：

- `id`: 系统活动主键
- `action_type`: 系统动作类型
- `owner_address`: 归属钱包地址
- `actor`: 动作执行者
- `request_id`: 请求追踪 ID
- `trace_id`: 链路追踪 ID
- `resource_type`: 资源类型
- `resource_id`: 资源 ID
- `result_status`: 执行结果状态
- `error_code`: 错误码
- `ip_address`: 客户端 IP
- `user_agent`: 客户端 UA
- `detail_json`: 结构化详情 JSON
- `created_at`: 记录创建时间

## 4. 去重、幂等与限流表

### `synapse_deposit_dedup`

用途：充值物理去重表，专门拦截 `tx_hash` 重放。

字段说明：

- `tx_hash`: 主键，同一笔充值交易只能出现一次
- `owner_address`: 归属钱包地址
- `request_id`: 首次处理的请求 ID
- `created_at`: 去重记录创建时间

### `synapse_withdraw_tx_dedup`

用途：提现 / 退款完成时的链上交易去重表，防止同一 `tx_hash` 被重复绑定到不同完成动作。

主键：`(owner_address, tx_hash, kind)`

字段说明：

- `owner_address`: 归属钱包地址
- `tx_hash`: 完成交易哈希
- `kind`: 类型，例如 buyer_refund、provider_withdraw
- `created_at`: 去重记录创建时间

### `synapse_idempotency_keys`

用途：请求幂等表，用于写请求的去重与重放保护。

关键约束：

- 主键 `id`
- 唯一约束 `(scope, owner_address, idempotency_key)`

字段说明：

- `id`: 幂等记录 ID
- `scope`: 幂等作用域，例如 refund、withdraw、credential_issue
- `owner_address`: 归属钱包地址
- `idempotency_key`: 调用方传入的幂等键
- `request_hash`: 请求内容哈希，用于防止“同 key 不同 payload”
- `response_code`: 上次响应码
- `response_digest`: 响应摘要
- `created_at`: 创建时间
- `expires_at`: 过期时间戳

### `synapse_finance_rate_limit`

用途：金融敏感动作的限流窗口状态表。

关键约束：

- 主键 `id`
- 唯一约束 `(owner_address, action)`

字段说明：

- `id`: 限流记录 ID
- `owner_address`: 归属钱包地址
- `action`: 受限动作类型，例如 `refund_complete`、`deposit_confirm`
- `window_start`: 当前窗口起始时间戳
- `count`: 当前窗口累计次数
- `updated_at`: 最后更新时间

## 5. 认证、凭据与权限表

### `synapse_credentials`

用途：统一保存 API 凭据，不存明文 token，只存 hash 和展示前缀。

字段说明：

- `id`: 凭据 ID
- `credential_type`: 凭据类型，例如 API_KEY
- `owner_address`: 凭据归属钱包地址
- `name`: 凭据名称
- `token_hash`: 凭据 hash
- `token_prefix`: 凭据展示前缀
- `status`: 凭据状态，例如 active、revoked、expired
- `max_calls`: 总调用额度
- `calls_used`: 已使用次数
- `rpm`: 每分钟请求上限
- `credit_limit`: 信用额度
- `reset_interval`: 配额重置周期
- `expiration`: 旧兼容字段
- `expires_at`: 过期时间戳
- `created_at`: 创建时间
- `updated_at`: 最后更新时间
- `revoked_at`: 吊销时间

### `synapse_wallet_roles`

用途：钱包地址到角色的映射表。

字段说明：

- `wallet_address`: 钱包地址，主键
- `role`: 钱包角色
- `updated_at`: 更新时间

### `synapse_auth_sessions`

用途：钱包登录态和最近活跃状态表。

字段说明：

- `wallet_address`: 会话绑定钱包地址，主键
- `registered_at`: 首次注册时间戳
- `last_login`: 最近登录时间戳
- `status`: 会话状态
- `updated_at`: 最后更新时间

## 6. 平台费率与路由控制表

### `synapse_router_config`

用途：按 owner 保存路由与消费限额控制。

字段说明：

- `owner_address`: 配置归属钱包地址，主键
- `daily_limit_usdc`: 每日限额
- `created_at`: 创建时间
- `updated_at`: 最后更新时间

### `synapse_platform_fee_policy_default`

用途：平台默认费率单例表。

字段说明：

- `singleton_id`: 单例配置 ID
- `default_rate`: 默认平台费率
- `updated_at`: 更新时间
- `updated_by`: 最后更新操作者

### `synapse_platform_fee_policy_owner`

用途：钱包级平台费率覆盖表。

字段说明：

- `owner_address`: 钱包地址，主键
- `fee_rate`: 钱包级平台费率

## 7. 服务注册与健康检查表

### `synapse_service_registry`

用途：卖家服务清单真相表，保存 marketplace / reverse proxy / metering 所需的完整服务元数据。

关键约束：

- 主键 `service_id`
- `status` 仅允许 `active`、`inactive`、`archived`
- 多个 JSON 字段必须保持 object 或 array 类型正确
- 价格和各种限额字段都有范围检查

字段说明：

- `service_id`: 服务唯一 ID
- `record_id`: 兼容前端编辑记录 ID
- `owner_address`: 服务拥有者钱包地址
- `service_name`: 服务名称
- `service_role`: 服务角色，默认 `Provider / Seller`
- `service_address`: 服务地址兼容字段
- `summary`: 服务简介
- `endpoint`: 主入口 URL
- `status`: 服务状态
- `is_active`: 是否激活
- `pricing_amount`: 定价金额
- `tags_json`: 服务标签 JSON 数组
- `auth_json`: 鉴权配置 JSON
- `health_check_json`: 健康检查配置 JSON
- `forwarding_json`: 转发策略 JSON
- `metering_json`: 计费策略 JSON
- `invoke_config`: 调用配置 JSON
- `pricing_currency`: 定价币种，默认 USDC
- `schema_version`: Manifest schema 版本
- `timeout_ms`: 上游超时阈值
- `max_qps`: 最大 QPS
- `max_request_bytes`: 最大请求体大小
- `max_response_bytes`: 最大响应体大小
- `created_at`: 创建时间
- `updated_at`: 更新时间

### `synapse_service_target_health`

用途：保存每个 service target 的最新健康快照。

主键：`(service_id, target_url)`

字段说明：

- `service_id`: 服务 ID
- `target_url`: 目标节点 URL
- `owner_address`: 节点归属钱包地址
- `status`: 当前探活状态
- `overall_status`: 聚合后的健康状态
- `http_status`: 最近 HTTP 状态码
- `latency_ms`: 最近延迟
- `consecutive_successes`: 连续成功次数
- `consecutive_failures`: 连续失败次数
- `probe_url`: 实际探活 URL
- `last_checked_at`: 最近检查时间戳
- `last_healthy_at`: 最近健康时间戳
- `error`: 最近错误
- `weight`: 节点权重
- `region`: 节点区域

### `synapse_service_target_health_history`

用途：保存健康检查历史轨迹，便于回溯故障与抖动。

字段说明：

- `id`: 历史主键
- `service_id`: 服务 ID
- `owner_address`: 节点归属钱包地址
- `target_url`: 目标 URL
- `status`: 本次探活状态
- `http_status`: HTTP 状态码
- `latency_ms`: 延迟
- `probe_url`: 探活 URL
- `consecutive_successes`: 连续成功次数
- `consecutive_failures`: 连续失败次数
- `checked_at`: 检查时间戳
- `last_healthy_at`: 最近健康时间戳
- `error`: 错误信息

## 8. 运行态与补偿表

### `synapse_processed_deposit_events`

用途：链上 deposit event 去重表，避免 indexer 和 backfill 重复消费同一条链上事件。

字段说明：

- `dedup_key`: 链上事件去重键，主键
- `updated_at`: 最近处理时间

### `synapse_runtime_state`

用途：保存 gateway 后台任务的持久化运行状态，例如 deposit backfill 游标、reconciliation 检查结果等。

字段说明：

- `state_key`: 运行状态键，主键
- `payload`: JSONB 载荷，保存具体状态内容
- `updated_at`: 最后更新时间

常见 `state_key`：

- `deposit_backfill_state`
- `deposit_reconciliation_state`

这张表的意义非常大：它把原本可能只存在进程内存的后台状态落成数据库真相，使服务重启后仍能恢复补偿游标和对账状态。

## 9. 后台只读投影视图

以下对象不是资金真相表，但对 `gateway-admin` 很关键：

- `synapse_admin_dashboard_finance_projection`
- `synapse_admin_dashboard_activity_trend_projection`
- `synapse_admin_dashboard_operations_projection`
- `synapse_admin_dashboard_projection`

用途：

- 让后台读取稳定 dashboard 语义
- 避免 admin 直接散查 gateway 真相表
- 把 finance、activity trend、operations 语义边界拆开

这些视图定义在 [infra/docker/postgres/init/003_gateway_admin_projection_views.sql](../../infra/docker/postgres/init/003_gateway_admin_projection_views.sql)。

## 10. 表分层总结

从职责上，gateway 数据库可以按下面 6 组理解：

1. 资金真相：`synapse_balances`、`synapse_deposit_intents`、`synapse_refund_intents`、`synapse_withdrawal_intents`、`synapse_usage_log`
2. 审计追溯：`synapse_audit_log`、`synapse_system_activity_log`
3. 去重与幂等：`synapse_deposit_dedup`、`synapse_withdraw_tx_dedup`、`synapse_idempotency_keys`
4. 风控与限流：`synapse_finance_rate_limit`、`synapse_router_config`、平台费率表
5. 服务治理：`synapse_service_registry`、健康快照与历史表
6. 运行态与补偿：`synapse_processed_deposit_events`、`synapse_runtime_state`、后台只读投影视图

## 11. 核心设计结论

- `synapse_balances` 是链下账本真相，不是展示缓存。
- `synapse_deposit_intents` 负责桥接“链上成功”和“平台已入账”之间的状态推进。
- `synapse_runtime_state` 是后台补偿与对账可恢复的关键落点。
- `synapse_idempotency_keys` 与各类 dedup 表一起，构成资金安全的物理兜底。
- `gateway-admin` 只能读投影视图，不应直接把真相表当看板数据源。

如果后续 schema 变更，必须同步更新本文件，不能让数据库设计文档重新过期。