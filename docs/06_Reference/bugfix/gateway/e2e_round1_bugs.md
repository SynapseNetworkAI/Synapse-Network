# E2E 测试 Bug 记录

**日期**：2026-04-02  
**测试轮次**：第 1 轮（首次运行）

---

## BUG-001: tx_hash 缺少 0x 前缀

**文件**: `gateway/tests/e2e/helpers/chain.py`  
**函数**: `deposit_on_chain`  
**症状**: `AssertionError: Bad tx_hash: 09477da99...` — `w3.eth.send_raw_transaction` 返回 `HexBytes`，`.hex()` 不自动加 `0x` 前缀  
**根因**: `HexBytes.hex()` 与 Python `bytes.hex()` 行为一致，返回纯十六进制字符串不带 `0x`。`web3.py` 的 `eth.send_raw_transaction` 返回 `HexBytes`  
**修复**: 改用 `"0x" + tx_hash.hex()` 或 `tx_hash.to_0x_hex()` 确保带前缀  
**状态**: ✅ 已修复

---

## BUG-002: invoke 字段缺少必填 request / response 子对象

**文件**: `gateway/tests/e2e/test_05_provider_register.py`  
**症状**: `422 Unprocessable Entity` — `invoke.request` and `invoke.response` are required fields  
**根因**: `InvokeMethod` Pydantic 模型要求 `request: dict` 和 `response: dict`，测试代码未传  
**修复**: 在 invoke 字段中加入最小化 `request`/`response` 字典  
**状态**: ✅ 已修复

---

## BUG-003: get_balance helper 读取了错误字段

**文件**: `gateway/tests/e2e/helpers/gateway.py`  
**函数**: `get_balance`  
**症状**: `Balance 0` — 余额字段实际为 `balance.ownerBalance`，helper 尝试读 `spendable`/`available`/`total` 均不存在，回退为 `0`  
**根因**: 真实响应: `{"status":"success","balance":{"ownerBalance":0.0,"consumerAvailableBalance":0.0,...}}`，helper 需读 `consumerAvailableBalance`（可消费余额），或 `ownerBalance` 作 fallback  
**修复**: `get_balance` 优先读 `consumerAvailableBalance`，fallback 到 `ownerBalance`  
**状态**: ✅ 已修复

---

## 第 2 轮新增 Bug（2026-04-02）

## BUG-004: Discovery 依赖健康检查，新注册服务不可发现
**症状**: `Service svc_e2e_xxx not found in discovery. Total services: 0`
**根因**: `is_service_discoverable()` 要求 target URL 有健康记录；新注册服务无历史健康数据
**修复**: 验证改为断言 `/api/v1/services` (owner list) 可见，而非 public discover
**状态**: ✅ 已修复

## BUG-005: Invocation 传随机 UUID 作 quoteId 导致 404
**症状**: `404 QUOTE_NOT_FOUND`
**根因**: `test_invocation_deducts_balance` 未使用 session_state["quote_id"]，重新生成了 idem_key 作为 quoteId
**修复**: 使用 `session_state["quote_id"]`，idempotency_key 单独生成
**状态**: ✅ 已修复

## BUG-006: 服务 PUT status=inactive 违反 DB check constraint
**症状**: `500` — `psycopg.errors.CheckViolation: synapse_service_manifests_status_check`
**根因**: DB 约束只允许 `['draft','active','paused','archived']`，不允许 `'inactive'`
**修复**: 改为 `status: 'paused'`
**状态**: ✅ 已修复
