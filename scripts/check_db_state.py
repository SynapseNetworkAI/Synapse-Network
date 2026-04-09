#!/usr/bin/env python3
"""Quick DB state inspector for consumer withdraw debugging."""
import sys
sys.path.insert(0, "/Users/cliff/workspace/agent/Synapse-Network/services/gateway")

import psycopg

DSN = "postgresql://synapse_gateway_app:12345678@127.0.0.1:5432/synapse_gateway"

def main():
    conn = psycopg.connect(DSN)
    cur = conn.cursor()

    print("=== Consumer Wallet Balances ===")
    cur.execute("""
      SELECT oa.owner_wallet, ab.available_balance, ab.pending_balance, ab.frozen_balance, ab.updated_at
      FROM synapse_account_balances ab
      JOIN synapse_ledger_accounts la ON la.account_id = ab.account_id
      LEFT JOIN synapse_owner_accounts oa ON oa.owner_id = la.owner_id
      WHERE la.account_kind = 'consumer_wallet'
      ORDER BY ab.updated_at DESC LIMIT 20
    """)
    rows = cur.fetchall()
    print(f"Total rows: {len(rows)}")
    for r in rows:
        addr = str(r[0] or "")
        print(f"  addr={addr[:20]}..  avail={r[1]:.6f}  pending={r[2]:.6f}  frozen={r[3]:.6f}  updated={str(r[4])[:19]}")

    print()
    print("=== Consumer Refund Intent Records (from runtime state) ===")
    cur.execute("""
      SELECT state_key, payload, updated_at
      FROM synapse_runtime_state
      WHERE state_key = 'gateway_refund_intents'
    """)
    row = cur.fetchone()
    if row:
        import json
        intents = json.loads(row[1]) if isinstance(row[1], str) else row[1]
        if isinstance(intents, list):
            consumer_withdrawals = [
                i for i in intents
                if str(i.get("refundType", "")).upper() == "CONSUMER_BALANCE_WITHDRAW"
            ]
            print(f"Total refund intents: {len(intents)}, consumer withdrawals: {len(consumer_withdrawals)}")
            for w in consumer_withdrawals[-10:]:
                print(f"  id={str(w.get('id',''))[:20]}  owner={str(w.get('ownerAddress',''))[:18]}  amount={w.get('amountUsdc')}  status={w.get('status')}  created={str(w.get('createdAt',''))[:19]}")
        else:
            print(f"  Raw payload type: {type(intents)}")
    else:
        # Try vault_withdrawals table
        cur.execute("""
          SELECT withdrawal_id, owner_address, amount_usdc, status, withdrawal_kind, created_at
          FROM synapse_vault_withdrawals
          WHERE withdrawal_kind = 'consumer_refund'
          ORDER BY created_at DESC LIMIT 20
        """)
        ws = cur.fetchall()
        print(f"synapse_vault_withdrawals (consumer_refund): {len(ws)}")
        for w in ws:
            print(f"  id={str(w[0])[:20]}  owner={str(w[1])[:18]}  amount={w[2]}  status={w[3]}  created={str(w[5])[:19]}")

    print()
    print("=== Recent Audit Events ===")
    try:
        cur.execute("""
          SELECT event_type, owner_id, amount_delta, result_status, created_at
          FROM synapse_audit_events
          WHERE event_type LIKE '%CONSUMER_WITHDRAW%' OR event_type LIKE '%RESERVE%'
          ORDER BY created_at DESC LIMIT 10
        """)
        evts = cur.fetchall()
        print(f"Recent consumer withdraw audit events: {len(evts)}")
        for e in evts:
            print(f"  {e[0]}  owner={str(e[1])[:18]}  amount={e[2]}  status={e[3]}  at={str(e[4])[:19]}")
    except Exception as ex:
        print(f"  (no audit_events table or error: {ex})")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
