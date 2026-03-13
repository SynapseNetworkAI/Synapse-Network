# 平台网关 V2 数据模型草案（4 张核心表）

> 目标：最小可用的数据模型，支持余额、凭据、调用流水、结算批次。

## 1. `balance_accounts`

用途：保存买家余额与账本状态。

字段：
- `id` (uuid, pk)
- `owner_address` (varchar, index)
- `asset_symbol` (varchar, default `USDC`)
- `available_amount` (decimal)
- `locked_amount` (decimal)
- `total_deposit_amount` (decimal)
- `total_spent_amount` (decimal)
- `status` (active/frozen)
- `created_at` (timestamp)
- `updated_at` (timestamp)

索引建议：
- unique(`owner_address`, `asset_symbol`)

---

## 2. `agent_credentials`

用途：保存调用凭据（仅存 hash，不存明文 token）。

字段：
- `id` (uuid, pk)
- `owner_address` (varchar, index)
- `agent_id` (varchar, index)
- `service_scope` (json/text)
- `token_hash` (varchar, unique)
- `token_prefix` (varchar)
- `status` (active/revoked/expired)
- `max_calls` (int)
- `calls_used` (int)
- `rpm_limit` (int)
- `expires_at` (timestamp, index)
- `revoked_at` (timestamp, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

索引建议：
- unique(`token_hash`)
- index(`owner_address`, `agent_id`)
- index(`expires_at`)

---

## 3. `usage_records`

用途：记录每次调用与计费流水（平台核心账本）。

字段：
- `id` (uuid, pk)
- `request_id` (varchar, unique)
- `buyer_address` (varchar, index)
- `seller_address` (varchar, index)
- `agent_id` (varchar, index)
- `service_id` (varchar, index)
- `credential_id` (uuid, nullable)
- `unit_price` (decimal)
- `platform_fee` (decimal)
- `seller_net` (decimal)
- `status` (accepted/succeeded/failed/refunded)
- `error_code` (varchar, nullable)
- `latency_ms` (int, nullable)
- `seller_response_hash` (varchar, nullable)
- `created_at` (timestamp, index)
- `updated_at` (timestamp)

索引建议：
- unique(`request_id`)（防重放、幂等）
- index(`buyer_address`, `created_at`)
- index(`seller_address`, `created_at`)
- index(`service_id`, `created_at`)

---

## 4. `settlement_batches`

用途：记录卖家批量结算执行结果与链上对账信息。

字段：
- `id` (uuid, pk)
- `batch_no` (varchar, unique)
- `chain_id` (int)
- `asset_symbol` (varchar)
- `seller_count` (int)
- `gross_amount` (decimal)
- `platform_fee_amount` (decimal)
- `net_amount` (decimal)
- `tx_hash` (varchar, nullable)
- `status` (pending/submitted/confirmed/failed)
- `range_start_at` (timestamp)
- `range_end_at` (timestamp)
- `created_at` (timestamp)
- `updated_at` (timestamp)

索引建议：
- unique(`batch_no`)
- index(`status`, `created_at`)
- index(`tx_hash`)

---

## 5. 一致性规则（必须）

1) `usage_records.request_id` 全局唯一，确保幂等。  
2) 扣费与 usage 状态更新同事务。  
3) `agent_credentials.calls_used` 只在成功计费后递增。  
4) 结算批次确认后，关联 usage 标记为 `settled=true`（可后续扩展字段）。

## 6. 状态流转建议

- usage：`accepted -> succeeded` 或 `accepted -> failed -> refunded`
- credential：`active -> revoked` 或 `active -> expired`
- settlement：`pending -> submitted -> confirmed` 或 `pending/submitted -> failed`

## 7. 与现有 JSON 存储兼容策略

若当前仍是 JSON 文件：
- 先按同结构实现 repository 接口；
- 后续切 DB 时仅替换 repository，不改网关业务逻辑。