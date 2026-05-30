from __future__ import annotations

from typing import Any

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.finance import BalanceLedger
from src.services.platform.business_policy import reconciliation_alert_delta
from src.storage import BaseStorage
from src.utils.money import MoneyCodec, money_str

from .chain import _amount_usdc_from_raw, _resolve_token_decimals
from .persistence import (
    _append_audit_log,
    _load_balance_ledger,
    _persist_indexer_runtime_state,
    _load_runtime_state,
    _save_runtime_state,
)
from .shared import _now, _set_status, get_web3, logger

RECONCILIATION_ALERT_COOLDOWN_SECONDS = 300


def _sum_ledger_obligation_usdc(ledger: BalanceLedger):
    """Return the full tracked internal balance still backed by vault collateral."""
    return MoneyCodec.coerce_decimal(ledger.total_vault_tracked_balance())


def _read_chain_vault_balance_usdc():
    """读取链上 router/vault 当前真实 USDC 余额。"""
    token = normalize_wallet(settings.usdc_token_address)
    router = normalize_wallet(settings.router_address)
    if not token or not router:
        return MoneyCodec.coerce_decimal(0)

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
    return MoneyCodec.coerce_decimal(
        _amount_usdc_from_raw(raw_balance, decimals=decimals)
    )


def run_reconciliation_check_once(storage: BaseStorage) -> dict[str, Any]:
    """对账：比较链上 vault 余额与平台账本义务是否一致。"""
    if not bool(settings.v2_reconciliation_enabled):
        return {"enabled": False}

    now = _now()
    ledger = _load_balance_ledger(storage)
    ledger_obligation = _sum_ledger_obligation_usdc(ledger)
    chain_vault = _read_chain_vault_balance_usdc()
    delta = MoneyCodec.coerce_decimal(abs(chain_vault - ledger_obligation))
    threshold = MoneyCodec.coerce_decimal(reconciliation_alert_delta(storage))
    alert = bool(delta > threshold)

    state = _load_runtime_state(storage, "deposit_reconciliation_state")
    last_alert_at = int(state.get("lastAlertAt") or 0)
    should_emit_alert = alert and (
        now - last_alert_at >= RECONCILIATION_ALERT_COOLDOWN_SECONDS
    )

    if should_emit_alert:
        logger.error(
            "alert_trigger=RECONCILIATION_DRIFT env=%s delta_usdc=%s "
            "chain_vault_usdc=%s ledger_obligation_usdc=%s threshold_usdc=%s",
            getattr(settings, "environment", "unknown"),
            money_str(delta),
            money_str(chain_vault),
            money_str(ledger_obligation),
            money_str(threshold),
        )
        state["lastAlertAt"] = now
        _append_audit_log(
            storage,
            "V2_DEPOSIT_RECONCILIATION_ALERT",
            normalize_wallet(settings.router_address),
            {
                "businessType": "deposit",
                "status": "ALERT",
                "chainVaultUsdc": money_str(chain_vault),
                "ledgerObligationUsdc": money_str(ledger_obligation),
                "deltaUsdc": money_str(delta),
                "thresholdUsdc": money_str(threshold),
            },
        )

    summary = {
        "enabled": True,
        "lastCheckAt": now,
        "chainVaultUsdc": money_str(chain_vault),
        "ledgerObligationUsdc": money_str(ledger_obligation),
        "deltaUsdc": money_str(delta),
        "alert": alert,
        "lastError": None,
    }
    _save_runtime_state(
        storage,
        "deposit_reconciliation_state",
        {
            **state,
            "lastCheckAt": now,
            "chainVaultUsdc": money_str(chain_vault),
            "ledgerObligationUsdc": money_str(ledger_obligation),
            "deltaUsdc": money_str(delta),
            "alert": alert,
        },
    )
    _set_status(reconciliation=summary)
    _persist_indexer_runtime_state(storage)
    logger.info(
        "deposit reconciliation checked chain_vault=%s ledger_obligation=%s delta=%s alert=%s",
        money_str(chain_vault),
        money_str(ledger_obligation),
        money_str(delta),
        alert,
    )
    return summary
