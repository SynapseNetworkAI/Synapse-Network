import json
import time
from typing import Any, Dict, List, Optional, Union
from decimal import Decimal, ROUND_HALF_UP

from .base import BaseStorage
from .normalizers import normalize_service_row

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psycopg = None


_COLLECTION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_collections (
    collection_name TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_AUDIT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_audit_log (
    id BIGSERIAL PRIMARY KEY,
    collection_name TEXT NOT NULL DEFAULT 'audit_log',
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_AUDIT_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_created_at
ON synapse_audit_log (created_at DESC);
"""

_AUDIT_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_owner
ON synapse_audit_log ((payload->>'ownerAddress'));
"""

_AUDIT_INSERT_SQL = "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)"

_DEPOSIT_DEDUP_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_deposit_dedup (
    tx_hash TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_WITHDRAW_TX_DEDUP_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_withdraw_tx_dedup (
    owner_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_address, tx_hash, kind)
);
"""

_DEPOSIT_DEDUP_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_deposit_dedup_owner
ON synapse_deposit_dedup (owner_address, created_at DESC);
"""

_WITHDRAW_TX_DEDUP_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_withdraw_tx_dedup_owner
ON synapse_withdraw_tx_dedup (owner_address, created_at DESC);
"""


def _d(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _q6(value: Any) -> Decimal:
    return _d(value).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def _json_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _json_rows(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        return [row for row in value["rows"] if isinstance(row, dict)]
    return []


class PostgresStorage(BaseStorage):
    def __init__(self, dsn: str, ensure_schema: bool = True):
        if psycopg is None:
            raise RuntimeError(
                "psycopg is not installed. Install dependency 'psycopg[binary]' before using PostgreSQL storage."
            )
        if not dsn.strip():
            raise RuntimeError("POSTGRES_DSN is required when STORAGE_BACKEND=postgres")

        self.dsn = dsn.strip()
        if ensure_schema:
            self._ensure_schema()

    def _connect(self):
        return psycopg.connect(self.dsn)

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(_COLLECTION_TABLE_SQL)
                cur.execute(_AUDIT_TABLE_SQL)
                cur.execute(_AUDIT_IDX_SQL)
                cur.execute(_AUDIT_OWNER_IDX_SQL)
                cur.execute(_DEPOSIT_DEDUP_TABLE_SQL)
                cur.execute(_WITHDRAW_TX_DEDUP_TABLE_SQL)
                cur.execute(_DEPOSIT_DEDUP_OWNER_IDX_SQL)
                cur.execute(_WITHDRAW_TX_DEDUP_OWNER_IDX_SQL)
            conn.commit()

    def _load_collection_for_update(self, cur: Any, collection_name: str) -> Any:
        cur.execute(
            "SELECT payload FROM synapse_collections WHERE collection_name = %s FOR UPDATE",
            (collection_name,),
        )
        row = cur.fetchone()
        if row is None:
            default_payload = self._default_collection(collection_name)
            cur.execute(
                "INSERT INTO synapse_collections (collection_name, payload, updated_at) VALUES (%s, %s::jsonb, NOW())",
                (collection_name, json.dumps(default_payload, ensure_ascii=False)),
            )
            return default_payload
        return row[0]

    def _save_collection_in_tx(self, cur: Any, collection_name: str, payload: Any) -> None:
        cur.execute(
            """
            INSERT INTO synapse_collections (collection_name, payload, updated_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (collection_name)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
            """,
            (collection_name, json.dumps(payload, ensure_ascii=False)),
        )

    def register_deposit_intent_atomic(self, owner_wallet: str, tx_hash: str, request_id: str, intent_row: Dict[str, Any]) -> Dict[str, Any]:
        # ACID + UNIQUE: tx_hash duplicate replay is blocked physically.
        with self._connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_deposit_dedup (tx_hash, owner_address, request_id) VALUES (%s, %s, %s)",
                        (tx_hash, owner_wallet, request_id or None),
                    )
                except psycopg.IntegrityError:
                    conn.rollback()
                    with self._connect() as lookup_conn:
                        with lookup_conn.cursor() as lookup_cur:
                            payload = self._load_collection_for_update(lookup_cur, "deposit_intents")
                            rows = _json_rows(payload)
                            for row in rows:
                                if str(row.get("txHash") or "").strip().lower() == str(tx_hash).strip().lower() and str(row.get("ownerAddress") or "") == owner_wallet:
                                    return row
                    return {}

                payload = self._load_collection_for_update(cur, "deposit_intents")
                rows = _json_rows(payload)
                rows.append(intent_row)
                self._save_collection_in_tx(cur, "deposit_intents", rows)
            conn.commit()
        return intent_row

    def charge_buyer_and_record_usage_atomic(
        self,
        *,
        owner_wallet: str,
        seller_wallet: str,
        total_charge: Decimal,
        seller_net: Decimal,
        platform_fee_total: Decimal,
        usage_row: Dict[str, Any],
    ) -> Dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                ledger_payload = self._load_collection_for_update(cur, "balance_ledger")
                ledger = _json_dict(ledger_payload)
                buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
                sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
                platform = ledger.get("platform") if isinstance(ledger.get("platform"), dict) else {}

                before_buyer = _q6(buyers.get(owner_wallet, "0"))
                if before_buyer < _q6(total_charge):
                    raise RuntimeError("INSUFFICIENT_BALANCE")

                buyers[owner_wallet] = float(_q6(before_buyer - _q6(total_charge)))
                sellers[seller_wallet] = float(_q6(_q6(sellers.get(seller_wallet, "0")) + _q6(seller_net)))
                platform["feeAccrued"] = float(_q6(_q6(platform.get("feeAccrued", "0")) + _q6(platform_fee_total)))

                ledger["buyers"] = buyers
                ledger["sellers"] = sellers
                ledger["platform"] = platform
                ledger["updatedAt"] = int(time.time())
                self._save_collection_in_tx(cur, "balance_ledger", ledger)

                usage_payload = self._load_collection_for_update(cur, "usage_log")
                usage_rows = usage_payload if isinstance(usage_payload, list) else []
                usage_rows.append(usage_row)
                self._save_collection_in_tx(cur, "usage_log", usage_rows)

                audit_payload = {
                    "id": usage_row.get("id") or "",
                    "timestamp": int(time.time()),
                    "action": "BUYER_CHARGE_ATOMIC",
                    "ownerAddress": owner_wallet,
                    "details": {
                        "beforeBalance": float(before_buyer),
                        "deltaAmount": float(-_q6(total_charge)),
                        "afterBalance": float(_q6(before_buyer - _q6(total_charge))),
                        "seller": seller_wallet,
                    },
                }
                cur.execute(
                    _AUDIT_INSERT_SQL,
                    ("audit_log", json.dumps(audit_payload, ensure_ascii=False)),
                )

            conn.commit()
        return {"buyerBalanceAfter": float(_q6(before_buyer - _q6(total_charge)))}

    def reserve_seller_withdraw_atomic(self, owner_wallet: str, amount_usdc: Decimal) -> Dict[str, float]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                ledger_payload = self._load_collection_for_update(cur, "balance_ledger")
                ledger = _json_dict(ledger_payload)
                sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
                sellers_locked = ledger.get("sellersLocked") if isinstance(ledger.get("sellersLocked"), dict) else {}

                before_available = _q6(sellers.get(owner_wallet, "0"))
                if before_available < _q6(amount_usdc):
                    raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")

                sellers[owner_wallet] = float(_q6(before_available - _q6(amount_usdc)))
                sellers_locked[owner_wallet] = float(_q6(_q6(sellers_locked.get(owner_wallet, "0")) + _q6(amount_usdc)))
                ledger["sellers"] = sellers
                ledger["sellersLocked"] = sellers_locked
                ledger["updatedAt"] = int(time.time())
                self._save_collection_in_tx(cur, "balance_ledger", ledger)
            conn.commit()
        return {
            "beforeBalance": float(before_available),
            "afterBalance": float(_q6(before_available - _q6(amount_usdc))),
        }

    def complete_withdraw_tx_atomic(self, owner_wallet: str, tx_hash: str, kind: str) -> bool:
        with self._connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_withdraw_tx_dedup (owner_address, tx_hash, kind) VALUES (%s, %s, %s)",
                        (owner_wallet, tx_hash, kind),
                    )
                except psycopg.IntegrityError:
                    conn.rollback()
                    return False
            conn.commit()
        return True

    def _default_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        if collection_name in {
            "credentials",
            "agent_credentials",
            "buyer_credentials",
            "seller_secrets",
            "provider_secrets",
        }:
            return {}
        return {} if "ledger" in collection_name or "config" in collection_name else []

    def _normalize_loaded_payload(self, collection_name: str, payload: Any) -> Union[List[Any], Dict[str, Any]]:
        if not isinstance(payload, dict):
            return payload

        if collection_name == "service_registry" and "services" in payload:
            services = payload["services"]
            if isinstance(services, list):
                return [normalize_service_row(svc) for svc in services]
            return services

        list_keys = {
            "agent_registry": "agents",
            "deposit_intents": "intents",
            "usage_log": "logs",
        }
        key = list_keys.get(collection_name)
        if key and key in payload:
            return payload[key]

        return payload

    def get_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        if collection_name == "audit_log":
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT payload FROM synapse_audit_log WHERE collection_name = %s ORDER BY id ASC",
                        (collection_name,),
                    )
                    rows = cur.fetchall()
            return [row[0] for row in rows if isinstance(row[0], dict)]

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT payload FROM synapse_collections WHERE collection_name = %s",
                    (collection_name,),
                )
                row = cur.fetchone()

        if row is None:
            return self._default_collection(collection_name)

        payload = row[0]
        return self._normalize_loaded_payload(collection_name, payload)

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        payload: Union[List[Any], Dict[str, Any]] = data

        if collection_name == "service_registry" and isinstance(data, list):
            payload = {"services": data, "updatedAt": int(time.time())}
        elif collection_name == "agent_registry" and isinstance(data, list):
            payload = {"agents": data, "updatedAt": int(time.time())}

        if collection_name == "audit_log":
            rows: List[Dict[str, Any]]
            if isinstance(payload, list):
                rows = [row for row in payload if isinstance(row, dict)]
            elif isinstance(payload, dict):
                rows = [payload]
            else:
                rows = []

            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM synapse_audit_log WHERE collection_name = %s",
                        (collection_name,),
                    )
                    for row in rows:
                        cur.execute(
                            _AUDIT_INSERT_SQL,
                            (collection_name, json.dumps(row, ensure_ascii=False)),
                        )
                conn.commit()
            return

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO synapse_collections (collection_name, payload, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (collection_name)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                    """,
                    (collection_name, json.dumps(payload, ensure_ascii=False)),
                )
            conn.commit()

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        if collection_name == "audit_log":
            row = item if isinstance(item, dict) else {"raw": item}
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        _AUDIT_INSERT_SQL,
                        (collection_name, json.dumps(row, ensure_ascii=False)),
                    )
                conn.commit()
            return

        data = self.get_collection(collection_name)
        if isinstance(data, list):
            data.append(item)
            self.save_collection(collection_name, data)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        sql = "SELECT payload FROM synapse_audit_log WHERE collection_name = %s"
        params: List[Any] = ["audit_log"]

        if owner_wallet:
            sql += " AND lower(payload->>'ownerAddress') = lower(%s)"
            params.append(owner_wallet)

        sql += " ORDER BY id DESC LIMIT %s"
        params.append(max(1, min(limit, 1000)))

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

        result = [row[0] for row in rows if isinstance(row[0], dict)]
        result.sort(key=lambda item: int(item.get("timestamp") or 0), reverse=True)
        return result
