from __future__ import annotations

from typing import Any

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import BalanceLedger
from src.storage import BaseStorage

from .chain import _amount_usdc_from_raw, _resolve_token_decimals
from .persistence import (
    _append_audit_log,
    _load_balance_ledger,
    _persist_indexer_runtime_state,
    _load_runtime_state,
    _save_runtime_state,
)
from .shared import _now, _set_status, get_web3, logger


def _sum_ledger_obligation_usdc(ledger: BalanceLedger) -> float:
    """统计买家可用+待确认资金总额，作为平台应付义务。"""
    return ledger.total_consumer_obligation()


def _read_chain_vault_balance_usdc() -> float:
    """读取链上 router/vault 当前真实 USDC 余额。"""
    token = normalize_wallet(settings.usdc_token_address)
    router = normalize_wallet(settings.router_address)
    if not token or not router:
        return 0.0

    abi = [
        {
            "constant": True,
            "inputs": [{"name": "account", "type": "address"}],
            "name": "balanceOf",
            "outputs": [{"name": "", "type": "uint256"}],
            "stateMutability": "view",
            "type": "function",
        }
    ]
    w3 = get_web3()
    contract = w3.eth.contract(address=w3.to_checksum_address(token), abi=abi)
    raw_balance = int(
        contract.functions.balanceOf(w3.to_checksum_address(router)).call()
    )
    decimals = _resolve_token_decimals(token)
    return _amount_usdc_from_raw(raw_balance, decimals=decimals)


def run_reconciliation_check_once(storage: BaseStorage) -> dict[str, Any]:
    """对账：比较链上 vault 余额与平台账本义务是否一致。"""
    if not bool(settings.v2_reconciliation_enabled):
        return {"enabled": False}

    now = _now()
    ledger = _load_balance_ledger(storage)
    ledger_obligation = _sum_ledger_obligation_usdc(ledger)
    chain_vault = _read_chain_vault_balance_usdc()
    delta = round(abs(chain_vault - ledger_obligation), 6)
    alert = bool(delta > float(settings.v2_reconciliation_alert_delta_usdc))

    state = _load_runtime_state(storage, "deposit_reconciliation_state")
    last_alert_at = int(state.get("lastAlertAt") or 0)
    should_emit_alert = alert and (now - last_alert_at >= 300)

    if should_emit_alert:
        state["lastAlertAt"] = now
        _append_audit_log(
            storage,
            "V2_DEPOSIT_RECONCILIATION_ALERT",
            normalize_wallet(settings.router_address),
            {
                "businessType": "deposit",
                "status": "ALERT",
                "chainVaultUsdc": chain_vault,
                "ledgerObligationUsdc": ledger_obligation,
                "deltaUsdc": delta,
                "thresholdUsdc": float(settings.v2_reconciliation_alert_delta_usdc),
            },
        )

    summary = {
        "enabled": True,
        "lastCheckAt": now,
        "chainVaultUsdc": chain_vault,
        "ledgerObligationUsdc": ledger_obligation,
        "deltaUsdc": delta,
        "alert": alert,
        "lastError": None,
    }
    _save_runtime_state(
        storage,
        "deposit_reconciliation_state",
        {
            **state,
            "lastCheckAt": now,
            "chainVaultUsdc": chain_vault,
            "ledgerObligationUsdc": ledger_obligation,
            "deltaUsdc": delta,
            "alert": alert,
        },
    )
    _set_status(reconciliation=summary)
    _persist_indexer_runtime_state(storage)
    logger.info(
        "deposit reconciliation checked chain_vault=%.6f ledger_obligation=%.6f delta=%.6f alert=%s",
        chain_vault,
        ledger_obligation,
        delta,
        alert,
    )
    return summary