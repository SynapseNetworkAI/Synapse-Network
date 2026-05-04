#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${REPO_ROOT}/services/gateway/.venv/bin/python"
LOCAL_GATEWAY_POSTGRES_PORT="${LOCAL_GATEWAY_POSTGRES_PORT:-15432}"
DEFAULT_LOCAL_POSTGRES_DSN="postgresql://synapse:local-dev-postgres-password@127.0.0.1:${LOCAL_GATEWAY_POSTGRES_PORT}/synapse_gateway"
POSTGRES_DSN="${LOCAL_GATEWAY_POSTGRES_DSN:-$DEFAULT_LOCAL_POSTGRES_DSN}"
WALLET_FILTER="${1:-}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

"$PYTHON_BIN" - "$POSTGRES_DSN" "$WALLET_FILTER" <<'PY'
from __future__ import annotations

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from urllib.parse import urlparse

import psycopg


dsn = sys.argv[1]
wallet_filter = (sys.argv[2] or "").strip().lower()
parsed = urlparse(dsn)
host = parsed.hostname or ""
dbname = (parsed.path or "").lstrip("/")
port = int(parsed.port or 5432)

if host not in {"127.0.0.1", "localhost", "::1"} or dbname != "synapse_gateway" or port not in {5432, 15432}:
    raise SystemExit(
        "[pending-deposit-diagnose] refusing non-local DSN. "
        "Set LOCAL_GATEWAY_POSTGRES_DSN only for localhost synapse_gateway."
    )


def encode(value: object) -> object:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def rows_to_dicts(cursor: psycopg.Cursor[object]) -> list[dict[str, object]]:
    columns = [desc.name for desc in cursor.description or []]
    return [
        {key: encode(value) for key, value in zip(columns, row)}
        for row in cursor.fetchall()
    ]


with psycopg.connect(dsn) as conn:
    conn.read_only = True
    with conn.cursor() as cur:
        params: list[object] = []
        wallet_clause = ""
        if wallet_filter:
            wallet_clause = "AND lower(vd.owner_address) = %s"
            params.append(wallet_filter)

        cur.execute(
            f"""
            SELECT
              vd.deposit_id,
              vd.owner_address,
              vd.tx_hash,
              vd.amount_usdc,
              vd.status,
              vd.block_number,
              vd.request_id,
              vd.client_request_id,
              vd.created_at,
              vd.updated_at
            FROM synapse_vault_deposits AS vd
            WHERE vd.status = 'PENDING_CONFIRMATION'
              {wallet_clause}
            ORDER BY vd.updated_at DESC, vd.created_at DESC
            LIMIT 100
            """,
            params,
        )
        pending_deposits = rows_to_dicts(cur)

        balance_params: list[object] = []
        balance_wallet_clause = ""
        if wallet_filter:
            balance_wallet_clause = "AND lower(oa.owner_wallet) = %s"
            balance_params.append(wallet_filter)
        cur.execute(
            f"""
            SELECT
              oa.owner_wallet,
              la.account_id,
              ab.available_balance,
              ab.pending_balance,
              ab.frozen_balance,
              ab.updated_at
            FROM synapse_account_balances AS ab
            JOIN synapse_ledger_accounts AS la ON la.account_id = ab.account_id
            JOIN synapse_owner_accounts AS oa ON oa.owner_id = la.owner_id
            WHERE la.account_kind = 'consumer_wallet'
              AND ab.pending_balance > 0
              {balance_wallet_clause}
            ORDER BY ab.updated_at DESC
            LIMIT 100
            """,
            balance_params,
        )
        consumer_pending_buckets = rows_to_dicts(cur)

payload = {
    "status": "success",
    "mode": "local_read_only",
    "walletFilter": wallet_filter or None,
    "pendingDeposits": pending_deposits,
    "consumerPendingBuckets": consumer_pending_buckets,
    "guidance": [
        "Do not force-credit pending deposits without matching current SynapseCore/USDC chain events.",
        "If txHash belongs to an old local contract or old chain, mark it as local dirty data through a separate local-only cleanup.",
        "If txHash is confirmed on the current contract, restart-safe Gateway indexer should move pending to available exactly once.",
    ],
}
print(json.dumps(payload, indent=2, sort_keys=True))
PY
