# Gateway Large-File Refactor Tracker

**Rule:** No file in `services/gateway/src/` may exceed 500 lines.  
**Verification:** `find services/gateway/src -name "*.py" | xargs wc -l | sort -rn | awk '$1 > 500'` must return empty.  
**Tests:** `cd services/gateway && python -m pytest tests/unit -q --tb=short` must keep ≥132 passing.

---

## Files to fix (as of 2026-04-04)

| # | File | Lines | Fns | Split strategy | Status |
|---|------|-------|-----|----------------|--------|
| 1 | `storage/postgres/repositories/finance_atomic_repository.py` | 1785 | 47 | `finance_atomic_core_mixin.py` + `finance_atomic_deposit_mixin.py` + `finance_atomic_withdraw_mixin.py` + `finance_atomic_voucher_mixin.py` | ✅ |
| 2 | `services/owner/finance_service.py` | 1604 | 66 | `finance_deposit_exec_mixin.py` + `finance_refund_analysis_mixin.py` + `finance_refund_exec_mixin.py` + `finance_constants.py` | ✅ |
| 3 | `services/provider/withdraw_service.py` | 1272 | 46 | `withdraw_helpers_mixin.py` + `withdraw_execution_mixin.py` | ✅ |
| 4 | `storage/postgres/repositories/service_registry_repository.py` | 955 | 44 | `service_registry_core_mixin.py` + `service_registry_query_mixin.py` | ✅ |
| 5 | `storage/postgres/repositories/gateway_state_repository.py` | 876 | 35 | `gateway_state_core_mixin.py` + `gateway_state_refund_mixin.py` + `gateway_state_withdrawal_mixin.py` | ✅ |
| 6 | `storage/postgres/repositories/credential_auth_repository.py` | 874 | 28 | `credential_auth_core_mixin.py` + `credential_auth_query_mixin.py` | ✅ |
| 7 | `api/routers/balance.py` | 845 | 38 | `balance_helpers.py` + `balance_deposit.py` + `balance_withdraw.py` + `balance_admin.py` | ✅ |
| 8 | `services/platform/service_health_service.py` | 736 | 39 | `service_health_utils.py` + `service_health_probe.py` | ✅ |
| 9 | `core/config.py` | 656 | 17 | `config_loaders.py` | ✅ |
| 10 | `services/platform/credential_service.py` | 608 | 32 | `credential_builders.py` | ✅ |
| 11 | `services/provider/manifest_parser_service.py` | 578 | 25 | `manifest_helpers.py` | ✅ |
| 12 | `services/provider/registry/payload_helpers.py` | 573 | 39 | `service_normalization.py` | ✅ |
| 13 | `services/balance_mixins/redis_guard.py` | 550 | 21 | `redis_guard_idempotency.py` + `redis_guard_rate_limit.py` | ✅ |

---

## Verification command (run after each fix)

```bash
cd /home/alex/Documents/cliff/Synapse-Network/services/gateway
python -m pytest tests/unit -q --tb=no 2>&1 | tail -5
wc -l /path/to/modified_file.py
```

Full sweep:
```bash
find /home/alex/Documents/cliff/Synapse-Network/services/gateway/src -name "*.py" \
  | xargs wc -l 2>/dev/null | sort -rn | awk '$1 > 500'
```
