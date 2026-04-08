#!/usr/bin/env python3
"""
Test atomic balance reservation.
Run: PYTHONPATH=. .venv/bin/python3.11 scripts/test_reservation.py
"""
import os
os.environ.setdefault("POSTGRES_DSN", "postgresql://synapse_gateway_app:12345678@127.0.0.1:5432/synapse_gateway")
os.environ.setdefault("POSTGRES_AUTO_INIT", "0")
os.environ.setdefault("ENVIRONMENT", "local")

from src.core.config import settings
from src.storage.postgres.repositories.balance_repository import BalanceRepository
from src.storage.postgres.db import PostgresDB
from src.utils.datetime_utils import now_dt_str

db = PostgresDB(settings.postgres_dsn)
repo = BalanceRepository(db)

owner = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
ledger = repo.read_balance_ledger()
avail_before = ledger.consumer_available_balance(owner)
pend_before = ledger.consumer_pending_balance(owner)
print(f"Before: available={avail_before:.6f} pending={pend_before:.6f}")

# Try to reserve $1
try:
    repo.reserve_consumer_balance_for_withdrawal(
        owner=owner, amount_usdc=1.0, updated_at=now_dt_str()
    )
    print("Reservation succeeded")
except RuntimeError as e:
    print(f"Reservation failed: {e}")

ledger2 = repo.read_balance_ledger()
avail_after = ledger2.consumer_available_balance(owner)
pend_after = ledger2.consumer_pending_balance(owner)
print(f"After:  available={avail_after:.6f} pending={pend_after:.6f}")
print(f"Delta:  available={avail_after - avail_before:+.6f} pending={pend_after - pend_before:+.6f}")

# Restore by writing back
if abs(avail_after - (avail_before - 1.0)) < 0.001:
    print("Reservation CORRECT - restoring...")
    # Directly update DB to restore
    with db.tx_cursor() as cur:
        cur.execute(
            "UPDATE synapse_account_balances SET available_balance = available_balance + 1, pending_balance = GREATEST(0, pending_balance - 1) WHERE account_id = (SELECT account_id FROM synapse_ledger_accounts la JOIN synapse_owner_accounts oa ON oa.owner_id = la.owner_id WHERE oa.owner_wallet=%s AND la.account_kind='consumer_wallet')",
            (owner,)
        )
        print(f"Restored {cur.rowcount} row(s)")
