# Gateway Environment Configuration

本文说明 Platform Gateway 关键环境变量的语义。

## 1. 必须显式配置

1. `ENVIRONMENT`
2. `RPC_URL`
3. `ROUTER_ADDRESS`
4. `USDC_TOKEN_ADDRESS`
5. `POSTGRES_DSN`
6. `JWT_SECRET`
7. `AUTH_SECRET`

## 2. 关键运行配置

### 2.1 Finance and Idempotency

1. `FINANCE_IDEMPOTENCY_TTL_SEC`
2. `FINANCE_IDEMPOTENCY_MAX_ROWS`
3. `FINANCE_REPLAY_WINDOW_SEC`
4. `FINANCE_WRITE_RATE_LIMIT_PER_MIN`

### 2.2 Withdrawal Risk Control

1. `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC`
2. `WITHDRAWAL_AUTO_24H_LIMIT_USDC`
3. `WITHDRAWAL_WINDOW_HOURS`
4. `WITHDRAWAL_HIGH_RISK_SELLER_ADDRESSES`

说明：`WITHDRAWAL_HIGH_RISK_SELLER_ADDRESSES` 仍是历史实现变量名，当前业务语义应理解为 Provider withdrawal 风控名单配置。

### 2.3 Indexer and Reconciliation

1. `V2_INDEXER_POLL_INTERVAL_SEC`
2. `V2_BACKFILL_BLOCK_BATCH`
3. `V2_RECONCILIATION_INTERVAL_SEC`
4. `V2_RECONCILIATION_ALERT_DELTA_USDC`

## 3. 建议

1. 本地开发可开启自动初始化与宽松阈值
2. 生产环境应显式关闭隐式建表或兼容自修补路径
3. 资金相关阈值必须和风控文档保持一致
