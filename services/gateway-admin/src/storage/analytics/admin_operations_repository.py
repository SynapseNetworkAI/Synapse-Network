from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from src.storage.analytics.admin_operations_models import (
    ConsumerDepositDetail,
    ConsumerDepositPage,
    ConsumerDepositRecord,
    OwnerAccountDetail,
    OwnerAccountPage,
    OwnerBalanceSummary,
    ProviderWithdrawalDetail,
    ProviderWithdrawalPage,
    ProviderWithdrawalRecord,
)
from src.storage.analytics.admin_operations_row_mapping import (
    decimal_value,
    deposit_filters,
    deposit_record,
    int_value,
    owner_filters,
    owner_record,
    pagination,
    withdrawal_filters,
    withdrawal_record,
)


OWNER_SORTS = {
    "created_desc": "oa.created_at DESC",
    "created_asc": "oa.created_at ASC",
    "updated_desc": "oa.updated_at DESC",
    "updated_asc": "oa.updated_at ASC",
}
DEPOSIT_SORTS = {
    "created_desc": "vd.created_at DESC",
    "created_asc": "vd.created_at ASC",
    "amount_desc": "vd.amount_usdc DESC",
    "amount_asc": "vd.amount_usdc ASC",
}
WITHDRAWAL_SORTS = {
    "created_desc": "vw.created_at DESC",
    "created_asc": "vw.created_at ASC",
    "amount_desc": "vw.amount_usdc DESC",
    "amount_asc": "vw.amount_usdc ASC",
}


class AdminOperationsRepository(Protocol):
    def list_owner_accounts(
        self,
        *,
        q: str | None,
        wallet: str | None,
        email: str | None,
        status: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> OwnerAccountPage: ...

    def get_owner_account(self, owner_id: str) -> OwnerAccountDetail | None: ...

    def list_consumer_deposits(
        self,
        *,
        wallet: str | None,
        tx_hash: str | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> ConsumerDepositPage: ...

    def get_consumer_deposit(self, deposit_id: str) -> ConsumerDepositDetail | None: ...

    def list_provider_withdrawals(
        self,
        *,
        wallet: str | None,
        tx_hash: str | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> ProviderWithdrawalPage: ...

    def get_provider_withdrawal(self, withdrawal_id: str) -> ProviderWithdrawalDetail | None: ...


def _connect(dsn: str):
    return psycopg.connect(dsn, row_factory=dict_row)


def _query_filters(filters: list[str], params: list[Any]) -> str:
    if not filters:
        return ""
    _ = params
    return " WHERE " + " AND ".join(filters)


class PostgresAdminOperationsRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def list_owner_accounts(
        self,
        *,
        q: str | None,
        wallet: str | None,
        email: str | None,
        status: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> OwnerAccountPage:
        filters, params = owner_filters(q=q, wallet=wallet, email=email, status=status)
        where_clause = _query_filters(filters, params)
        order_by = OWNER_SORTS.get(sort, OWNER_SORTS["created_desc"])
        offset = (page - 1) * page_size
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            count_query = f"SELECT COUNT(*) AS total FROM synapse_owner_accounts oa{where_clause}"  # noqa: S608 -- where clause is assembled from fixed predicates and parameterized values.
            cur.execute(count_query, params)
            total = int_value(cur.fetchone()["total"])
            list_query = f"""
            SELECT
                oa.owner_id,
                oa.owner_wallet,
                oa.display_name,
                oa.email,
                oa.email_verified,
                oa.pending_email,
                oa.status,
                oa.created_at,
                oa.updated_at,
                EXISTS (SELECT 1 FROM synapse_provider_profiles pp WHERE pp.owner_id = oa.owner_id) AS is_provider,
                (SELECT COUNT(*) FROM synapse_agent_profiles ap WHERE ap.owner_id = oa.owner_id) AS agent_count,
                (SELECT COUNT(*) FROM synapse_service_manifests sm WHERE sm.owner_id = oa.owner_id AND sm.status <> 'deleted') AS service_count,
                (SELECT COUNT(*) FROM synapse_feedback_reports fr WHERE LOWER(fr.owner_address) = LOWER(oa.owner_wallet)) AS support_case_count,
                GREATEST(
                    oa.updated_at,
                    COALESCE((SELECT MAX(vd.updated_at) FROM synapse_vault_deposits vd WHERE vd.owner_id = oa.owner_id), oa.updated_at),
                    COALESCE((SELECT MAX(vw.updated_at) FROM synapse_vault_withdrawals vw WHERE vw.owner_id = oa.owner_id), oa.updated_at),
                    COALESCE((SELECT MAX(sm.updated_at) FROM synapse_service_manifests sm WHERE sm.owner_id = oa.owner_id), oa.updated_at)
                ) AS last_active_at
            FROM synapse_owner_accounts oa
            {where_clause}
            ORDER BY {order_by}, oa.owner_id ASC
            LIMIT %s OFFSET %s
            """  # noqa: S608 -- order/where fragments are selected from server-side whitelists.
            cur.execute(
                list_query,
                [*params, page_size, offset],
            )
            rows = cur.fetchall()
        return OwnerAccountPage(
            items=tuple(owner_record(row) for row in rows),
            pagination=pagination(page, page_size, total),
        )

    def get_owner_account(self, owner_id: str) -> OwnerAccountDetail | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT oa.owner_id, oa.owner_wallet, oa.display_name, oa.email, oa.email_verified,
                       oa.pending_email, oa.status, oa.created_at, oa.updated_at,
                       EXISTS (SELECT 1 FROM synapse_provider_profiles pp WHERE pp.owner_id = oa.owner_id) AS is_provider,
                       (SELECT COUNT(*) FROM synapse_agent_profiles ap WHERE ap.owner_id = oa.owner_id) AS agent_count,
                       (SELECT COUNT(*) FROM synapse_service_manifests sm WHERE sm.owner_id = oa.owner_id AND sm.status <> 'deleted') AS service_count,
                       (SELECT COUNT(*) FROM synapse_feedback_reports fr WHERE LOWER(fr.owner_address) = LOWER(oa.owner_wallet)) AS support_case_count,
                       oa.updated_at AS last_active_at
                FROM synapse_owner_accounts oa
                WHERE oa.owner_id = %s
                LIMIT 1
                """,
                (owner_id.strip(),),
            )
            owner_row = cur.fetchone()
            if owner_row is None:
                return None
            owner = owner_record(owner_row)
            balances = self._owner_balances(cur, owner.owner_id)
            recent_deposits = self._recent_deposits(cur, owner.owner_id)
            recent_withdrawals = self._recent_provider_withdrawals(cur, owner.owner_id)
            recent_invocations = self._recent_invocations(cur, owner.owner_id)
            support_cases = self._support_cases(cur, owner.owner_wallet)
        return OwnerAccountDetail(
            account=owner,
            balances=balances,
            recent_deposits=recent_deposits,
            recent_provider_withdrawals=recent_withdrawals,
            recent_invocations=recent_invocations,
            support_cases=support_cases,
        )

    def list_consumer_deposits(
        self,
        *,
        wallet: str | None,
        tx_hash: str | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> ConsumerDepositPage:
        filters, params = deposit_filters(wallet, tx_hash, status, date_from, date_to)
        where_clause = _query_filters(filters, params)
        order_by = DEPOSIT_SORTS.get(sort, DEPOSIT_SORTS["created_desc"])
        offset = (page - 1) * page_size
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            count_query = f"SELECT COUNT(*) AS total FROM synapse_vault_deposits vd JOIN synapse_owner_accounts oa ON oa.owner_id = vd.owner_id{where_clause}"  # noqa: S608 -- where clause is assembled from fixed predicates and parameterized values.
            cur.execute(count_query, params)
            total = int_value(cur.fetchone()["total"])
            list_query = f"""
            SELECT vd.*, oa.owner_wallet, oa.email AS owner_email, rs.payload AS meta_payload
            FROM synapse_vault_deposits vd
            JOIN synapse_owner_accounts oa ON oa.owner_id = vd.owner_id
            LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_deposit_meta::', vd.deposit_id)
            {where_clause}
            ORDER BY {order_by}, vd.deposit_id ASC
            LIMIT %s OFFSET %s
            """  # noqa: S608 -- order/where fragments are selected from server-side whitelists.
            cur.execute(
                list_query,
                [*params, page_size, offset],
            )
            rows = cur.fetchall()
        return ConsumerDepositPage(
            items=tuple(deposit_record(row) for row in rows),
            pagination=pagination(page, page_size, total),
        )

    def get_consumer_deposit(self, deposit_id: str) -> ConsumerDepositDetail | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT vd.*, oa.owner_wallet, oa.email AS owner_email, rs.payload AS meta_payload
                FROM synapse_vault_deposits vd
                JOIN synapse_owner_accounts oa ON oa.owner_id = vd.owner_id
                LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_deposit_meta::', vd.deposit_id)
                WHERE vd.deposit_id = %s
                LIMIT 1
                """,
                (deposit_id.strip(),),
            )
            row = cur.fetchone()
            if row is None:
                return None
            detail_id = str(row["deposit_id"])
            return ConsumerDepositDetail(
                deposit=deposit_record(row),
                ledger_entries=self._ledger_entries(cur, detail_id),
                audit_events=self._audit_events(cur, detail_id),
                notification_events=self._notification_events(cur, detail_id),
            )

    def list_provider_withdrawals(
        self,
        *,
        wallet: str | None,
        tx_hash: str | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> ProviderWithdrawalPage:
        filters, params = withdrawal_filters(wallet, tx_hash, status, date_from, date_to)
        where_clause = _query_filters(["vw.withdrawal_kind = 'provider_withdrawal'", *filters], params)
        order_by = WITHDRAWAL_SORTS.get(sort, WITHDRAWAL_SORTS["created_desc"])
        offset = (page - 1) * page_size
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            count_query = f"SELECT COUNT(*) AS total FROM synapse_vault_withdrawals vw JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id{where_clause}"  # noqa: S608 -- where clause is fixed/parameterized.
            cur.execute(count_query, params)
            total = int_value(cur.fetchone()["total"])
            list_query = f"""
            SELECT vw.*, oa.owner_wallet, oa.email AS owner_email, pp.display_name AS provider_name,
                   rs.payload AS meta_payload
            FROM synapse_vault_withdrawals vw
            JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id
            LEFT JOIN synapse_provider_profiles pp ON pp.provider_id = vw.provider_id
            LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
            {where_clause}
            ORDER BY {order_by}, vw.withdrawal_id ASC
            LIMIT %s OFFSET %s
            """  # noqa: S608 -- order/where fragments are selected from server-side whitelists.
            cur.execute(
                list_query,
                [*params, page_size, offset],
            )
            rows = cur.fetchall()
        return ProviderWithdrawalPage(
            items=tuple(withdrawal_record(row) for row in rows),
            pagination=pagination(page, page_size, total),
        )

    def get_provider_withdrawal(self, withdrawal_id: str) -> ProviderWithdrawalDetail | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT vw.*, oa.owner_wallet, oa.email AS owner_email, pp.display_name AS provider_name,
                       rs.payload AS meta_payload
                FROM synapse_vault_withdrawals vw
                JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id
                LEFT JOIN synapse_provider_profiles pp ON pp.provider_id = vw.provider_id
                LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
                WHERE vw.withdrawal_kind = 'provider_withdrawal'
                  AND vw.withdrawal_id = %s
                LIMIT 1
                """,
                (withdrawal_id.strip(),),
            )
            row = cur.fetchone()
            if row is None:
                return None
            detail_id = str(row["withdrawal_id"])
            return ProviderWithdrawalDetail(
                withdrawal=withdrawal_record(row),
                ledger_entries=self._ledger_entries(cur, detail_id),
                audit_events=self._audit_events(cur, detail_id),
                notification_events=self._notification_events(cur, detail_id),
                review_history=self._review_history(cur, detail_id),
            )

    def _owner_balances(self, cur, owner_id: str) -> OwnerBalanceSummary:
        cur.execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN la.account_kind = 'consumer_wallet' THEN ab.available_balance ELSE 0 END), 0) AS consumer_available,
                COALESCE(SUM(CASE WHEN la.account_kind = 'consumer_wallet' THEN ab.frozen_balance ELSE 0 END), 0) AS consumer_frozen,
                COALESCE(SUM(CASE WHEN la.account_kind = 'provider_wallet' THEN ab.available_balance ELSE 0 END), 0) AS provider_available,
                COALESCE(SUM(CASE WHEN la.account_kind = 'provider_wallet' THEN ab.frozen_balance ELSE 0 END), 0) AS provider_frozen
            FROM synapse_ledger_accounts la
            JOIN synapse_account_balances ab ON ab.account_id = la.account_id
            WHERE la.owner_id = %s
            """,
            (owner_id,),
        )
        row = cur.fetchone() or {}
        return OwnerBalanceSummary(
            consumer_available_usdc=decimal_value(row.get("consumer_available")),
            consumer_frozen_usdc=decimal_value(row.get("consumer_frozen")),
            provider_available_usdc=decimal_value(row.get("provider_available")),
            provider_frozen_usdc=decimal_value(row.get("provider_frozen")),
        )

    def _recent_deposits(self, cur, owner_id: str) -> tuple[ConsumerDepositRecord, ...]:
        cur.execute(
            """
            SELECT vd.*, oa.owner_wallet, oa.email AS owner_email, rs.payload AS meta_payload
            FROM synapse_vault_deposits vd
            JOIN synapse_owner_accounts oa ON oa.owner_id = vd.owner_id
            LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_deposit_meta::', vd.deposit_id)
            WHERE vd.owner_id = %s
            ORDER BY vd.created_at DESC
            LIMIT 5
            """,
            (owner_id,),
        )
        return tuple(deposit_record(row) for row in cur.fetchall())

    def _recent_provider_withdrawals(self, cur, owner_id: str) -> tuple[ProviderWithdrawalRecord, ...]:
        cur.execute(
            """
            SELECT vw.*, oa.owner_wallet, oa.email AS owner_email, pp.display_name AS provider_name, rs.payload AS meta_payload
            FROM synapse_vault_withdrawals vw
            JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id
            LEFT JOIN synapse_provider_profiles pp ON pp.provider_id = vw.provider_id
            LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
            WHERE vw.owner_id = %s AND vw.withdrawal_kind = 'provider_withdrawal'
            ORDER BY vw.created_at DESC
            LIMIT 5
            """,
            (owner_id,),
        )
        return tuple(withdrawal_record(row) for row in cur.fetchall())

    @staticmethod
    def _recent_invocations(cur, owner_id: str) -> tuple[dict, ...]:
        cur.execute(
            """
            SELECT inv.invocation_id, inv.service_id, inv.status, inv.charged_usdc, inv.created_at
            FROM synapse_invocations inv
            JOIN synapse_agent_credentials cred ON cred.credential_id = inv.credential_id
            JOIN synapse_agent_profiles agent ON agent.agent_id = cred.agent_id
            WHERE agent.owner_id = %s
            ORDER BY inv.created_at DESC
            LIMIT 5
            """,
            (owner_id,),
        )
        return tuple(dict(row) for row in cur.fetchall())

    @staticmethod
    def _support_cases(cur, wallet: str) -> tuple[dict, ...]:
        cur.execute(
            """
            SELECT feedback_id, category, status, route, created_at, updated_at
            FROM synapse_feedback_reports
            WHERE LOWER(owner_address) = LOWER(%s)
            ORDER BY created_at DESC
            LIMIT 5
            """,
            (wallet,),
        )
        return tuple(dict(row) for row in cur.fetchall())

    @staticmethod
    def _ledger_entries(cur, resource_id: str) -> tuple[dict, ...]:
        cur.execute(
            """
            SELECT entry_id, reference_type, business_type, debit_account_id, credit_account_id,
                   amount_usdc, status, request_id, trace_id, created_at
            FROM synapse_ledger_entries
            WHERE reference_id = %s
            ORDER BY created_at DESC
            LIMIT 25
            """,
            (resource_id,),
        )
        return tuple(dict(row) for row in cur.fetchall())

    @staticmethod
    def _audit_events(cur, resource_id: str) -> tuple[dict, ...]:
        cur.execute(
            """
            SELECT event_id, event_type, business_type, owner_id, provider_id,
                   agent_id, credential_id, service_id, quote_id, invocation_id,
                   amount_delta, result_status, error_code, created_at
            FROM synapse_audit_events
            WHERE invocation_id = %s
               OR quote_id = %s
               OR detail_json::text ILIKE %s
            ORDER BY created_at DESC
            LIMIT 25
            """,
            (resource_id, resource_id, f"%{resource_id}%"),
        )
        return tuple(dict(row) for row in cur.fetchall())

    @staticmethod
    def _notification_events(cur, resource_id: str) -> tuple[dict, ...]:
        cur.execute(
            """
            SELECT notification_id, event_type, category, severity, priority, title,
                   resource_type, resource_id, created_at
            FROM synapse_in_app_notifications
            WHERE resource_id = %s
            ORDER BY created_at DESC
            LIMIT 25
            """,
            (resource_id,),
        )
        return tuple(dict(row) for row in cur.fetchall())

    @staticmethod
    def _review_history(cur, withdrawal_id: str) -> tuple[dict, ...]:
        cur.execute(
            """
            SELECT event_id, event_type, business_type, owner_id, provider_id,
                   amount_delta, result_status, error_code, created_at
            FROM synapse_audit_events
            WHERE detail_json::text ILIKE %s
              AND business_type ILIKE '%withdraw%'
            ORDER BY created_at DESC
            LIMIT 25
            """,
            (f"%{withdrawal_id}%",),
        )
        return tuple(dict(row) for row in cur.fetchall())
