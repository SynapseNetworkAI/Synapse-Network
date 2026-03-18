# Deposit Reconciliation Backoffice Requirements

## 1. Background

Synapse 的充值链路采用 intent-first 模型：只有当 Owner deposit intent 与链上 Vault 事件完成匹配并确认后，平台账本才会把资金从 `consumer_pending` 推进到 `consumer_available`。

当链上充值成功、但前端或网络导致 intent 提交失败时，链上 Vault 与平台账本就可能短时偏离。

本文件定义后台对账与补救能力，确保 Admin Control Plane 可以在不手工改库的前提下恢复一致性。

## 2. Goals

1. 自动发现漏记充值。
2. 持续检测链上 Vault 与平台账本的偏差。
3. 提供可审计的 replay 能力，而不是依赖手工 SQL 修复。
4. 让 Owner 充值体验在前端瞬时失败时仍可恢复。

## 3. Scope

### 3.1 Backend Runtime Capabilities

1. Backfill scanner task
   扫描确认后的区块范围，识别缺失 intent 的 deposit 事件，并复用正式确认路径完成补记。
2. Reconciliation metric
   比较 Vault 持仓与平台账本义务，当偏差超过阈值时触发告警并保留快照。
3. Admin replay API
   允许管理员按 `txHash` 重新解析链上事件、补建 intent、重放确认流程。

### 3.2 Frontend Resilience

1. 链上交易成功但 intent 提交失败时，浏览器应本地保留重试任务。
2. 重试任务在 session 存续期间按退避策略继续提交。
3. 提交成功后自动清理本地任务并刷新余额状态。

## 4. Non-functional Requirements

1. Idempotent recovery
   重放和补扫不能造成双重入账。
2. Operational visibility
   indexer status 必须暴露 backfill 与 reconciliation 摘要。
3. No manual SQL for daily operations
   日常生产修复应通过 replay、backfill、reconciliation 完成。
4. Auditability
   所有 replay 和告警都必须留下独立审计记录。

## 5. Data and State Contract

1. `deposit_backfill_state`
   至少跟踪 `lastScannedBlock`、`lastScanAt`、`updatedAt`。
2. `deposit_reconciliation_state`
   至少跟踪 `lastAlertAt`、`updatedAt`。
3. Indexer status extension
   至少暴露 backfill 游标、recovered 统计、reconciliation delta、alert 状态。

## 6. Admin API Contract

### 6.1 Replay Deposit by Tx Hash

1. Method: `POST`
2. Path: `/api/v1/admin/deposits/replay`
3. Input: `txHash`
4. Auth: admin wallets only

成功响应至少要表达：

1. `requestedBy`
2. `txHash`
3. 识别到的事件数
4. 新建 intent 数
5. credited / failed / pending 汇总

错误面至少覆盖：

1. `INVALID_TX_HASH`
2. `TX_NOT_CONFIRMED`
3. `TX_FAILED`
4. `MISSING_TX_RECEIPT`
5. `NO_MATCHING_DEPOSIT_EVENT`

## 7. Operations Playbook

1. Owner 反馈链上成功但 Gateway 余额未增长。
2. Admin 查看 `GET /api/v1/indexer/status`，确认 backfill 进度与 reconciliation delta。
3. Admin 用 `txHash` 触发 replay。
4. 核验 replay 摘要、余额变化和审计事件。
5. 若偏差仍存在，则升级为生产事件并继续调查 Vault、token 配置或链上数据异常。

## 8. Rollout Plan

1. 先在 development 打开并使用安全阈值。
2. 用历史 `txHash` 校验 replay 的幂等性。
3. 在 staging 验证重复 replay 不会双记账。
4. 最后在 production 打开并配套审计监控。

## 9. Future Enhancements

1. 多 token Vault reconciliation panel
2. CSV 批量 replay 工作流
3. drift trend 与 incident auto-ticket integration
4. Gradually enable in production with audit monitoring.

## 9. Future Enhancements

1. Multi-token vault reconciliation panel.
2. Backoffice UI workflow for bulk replay from CSV.
3. Drift trend chart and incident auto-ticket integration.
