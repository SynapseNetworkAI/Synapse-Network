# Gateway Examples — Bugfix Log

## 2026-04-09 批量修复

### 1. `credential_issue_invoke_revoke.py` — 未定义变量 + API 不匹配

**症状**: `RuntimeError: Missing env: SERVICE_ID`，以及多个 `NameError`

**根因**: `main()` 中缺少 `api_base`、`rpc_url`、`owner_private_key`、`root_dir` 四个变量的定义。

**修复**:
- 在 `main()` 开头添加缺失变量的初始化（从环境变量/默认值读取）

---

### 2. `credential_issue_invoke_revoke.py` / `v2_daily_limit_regression.py` — 认证 API 字段不匹配

**症状**: `KeyError: 'message'`

**根因**: 脚本使用 `challenge["message"]` / `challenge["nonce"]`，但实际 API 返回格式为 `{"challenge": "...", "domain": "..."}` — 无 `message` / `nonce` 字段。验证接口请求体使用 `address` / `nonce`，但实际需要 `wallet_address` / `message`。返回字段为 `access_token`，非 `token`。

**修复**:
- `challenge["message"]` → `challenge["challenge"]`
- 验证 body: `{"address": ..., "nonce": ...}` → `{"wallet_address": ..., "message": ..., "signature": ...}`
- 返回值: `verified["token"]` → `verified["access_token"]`

---

### 3. `credential_issue_invoke_revoke.py` / `v2_daily_limit_regression.py` — 合约路径错误

**症状**: `FileNotFoundError: .../frontend/src/contract-config.json`

**根因**: 脚本引用 `root_dir / "frontend" / "src"` 但实际路径为 `services/user-front/src`。

**修复**:
- `"frontend"` → `"user-front"`
- 调整 `root_dir = Path(__file__).resolve().parents[2]`（指向 `services/`）

---

### 4. `credential_issue_invoke_revoke.py` / `v2_daily_limit_regression.py` — 合约函数名错误

**症状**: `The function 'payForService' was not found in this contract's abi.`

**根因**: SynapseCore 合约的支付函数为 `deposit(uint256 amount)`，不是 `payForService(token, provider, amount, serviceId)`。

**修复**:
- `router_contract.functions.payForService(...)` → `router_contract.functions.deposit(amount_wei)`

---

### 5. `credential_issue_invoke_revoke.py` — 缺少充值意图提交步骤

**症状**: `402 Payment Required — INSUFFICIENT_BALANCE`

**根因**: 链上 `deposit()` 执行成功后，脚本直接调用 `generate`。但 Gateway 需要通过 `POST /balance/deposit/intent` 接收充值通知 + indexer 确认后才计入余额。

**修复**:
- 新增 `_submit_and_wait_deposit()` 函数：提交 deposit intent（含 `X-Idempotency-Key`），轮询直到 status=confirmed
- 在链上充值和服务调用之间插入此步骤

---

### 6. `credential_issue_invoke_revoke.py` / `v2_daily_limit_regression.py` — 缺少 X-Idempotency-Key

**症状**: `422 Unprocessable Entity` on deposit intent

**根因**: `POST /v1/balance/deposit/intent` 要求 `X-Idempotency-Key` 请求头（16-128字符），脚本未发送。

**修复**:
- 在 deposit intent 请求中添加 `X-Idempotency-Key` 头
- tx_hash 确保 `0x` 前缀（满足 66 字符校验）

---

### 7. `synapse_client_quickstart.py` — 字符串语法错误

**症状**: `SyntaxError: unterminated string literal`

**根因**: `print("` 后面直接换行，Python 不允许裸换行在普通字符串中。

**修复**:
- `print("\n...")` 替换裸换行为 `\n` 转义

---

### 8. `synapse_client_quickstart.py` — SDK 方法名不匹配

**症状**: `'SynapseClient' object has no attribute 'call_service'`

**根因**: 实际 SDK 方法为 `invoke(service_id, payload, cost_usdc=...)`，不是 `call_service`。`discovery.services` 应为 `discovery.results`，`response.content/fee_deducted` 应为 `response.result/charged_usdc`。

**修复**:
- `client.call_service(...)` → `client.invoke(service_id=..., payload=..., cost_usdc=...)`
- `discovery.services` → `discovery.results`
- `services[0].serviceId` → `results[0].service_id`
- 使用 `response.result` / `response.charged_usdc` / `response.invocation_id`

---

### 9. `synapse_client_quickstart.py` — payload 字段名错误

**症状**: `422 Unprocessable Entity` from provider

**根因**: Provider quotes 接口需要 `text` 字段，脚本发送 `prompt`。

**修复**:
- `{"prompt": "..."}` → `{"text": "..."}`

---

### 10. `v2_daily_limit_regression.py` — 日限额 API 路径错误

**症状**: `404 Not Found for url: .../api/v1/router/config`

**根因**: 日限额设置接口为 `PUT /v1/balance/spending-limit`（body: `{spendingLimitUsdc: n}`），不是 `POST /v1/router/config`（body: `{dailyLimitUsdc: n}`）。

**修复**:
- `POST /api/v1/router/config` → `PUT /api/v1/balance/spending-limit`
- `{"dailyLimitUsdc": ...}` → `{"spendingLimitUsdc": ...}`

---

### 11. `v2_daily_limit_regression.py` — pricing 解析错误

**症状**: `TypeError: float() argument must be a string or a real number, not 'dict'`

**根因**: discover 返回 `pricing: {"amount": "0.01", "currency": "USDC"}`（对象），脚本用 `float(target.get("pricing", 0))` 当作数值解析。

**修复**:
- `float(target.get("pricing", 0))` → `float(pricing.get("amount", 0) if isinstance(pricing, dict) else pricing)`

---

### 12. `v2_daily_limit_regression.py` — 错误码不匹配

**症状**: `Expected DAILY_LIMIT_EXCEEDED, got OWNER_BILLING_CYCLE_LIMIT_EXCEEDED`

**根因**: Gateway 返回的 402 错误码为 `OWNER_BILLING_CYCLE_LIMIT_EXCEEDED`，不是 `DAILY_LIMIT_EXCEEDED`。

**修复**:
- 期望码更新为 `OWNER_BILLING_CYCLE_LIMIT_EXCEEDED`

---

### 13. `v2_daily_limit_regression.py` — 日限额不考虑已有周期消费

**症状**: 第一次调用就被 402（spending limit exceeded）

**根因**: 设置 `spendingLimitUsdc = unit_price * 1.05`，但 `currentCycleSpendUsdc` 可能已有历史消费，导致 remaining < 一次调用费用。

**修复**:
- 先 `GET /balance/spending-limit` 读取 `currentCycleSpendUsdc`
- 设置 `limit = current_spend + unit_price * 1.05`，确保刚好够一次调用
