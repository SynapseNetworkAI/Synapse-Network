from __future__ import annotations

import json
from decimal import Decimal
from typing import Any, Optional

from src.domain.execution import (
    InvocationRecord,
    InvocationResultRecord,
    InvokeConstraintRecord,
    ServiceQuoteRecord,
)
from src.utils.datetime_utils import to_dt_str

from ..database_manager import DatabaseManager


class ExecutionRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    @staticmethod
    def _payload_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _quote_from_row(row: Any) -> ServiceQuoteRecord:
        (
            quote_id,
            service_id,
            credential_id,
            agent_id,
            quoted_price_usdc,
            price_model,
            status,
            request_fingerprint,
            response_mode,
            invoke_constraints,
            expires_at,
            created_at,
        ) = row
        return ServiceQuoteRecord(
            quoteId=str(quote_id),
            serviceId=str(service_id),
            credentialId=str(credential_id),
            agentId=str(agent_id),
            quotedPriceUsdc=Decimal(str(quoted_price_usdc)),
            priceModel=str(price_model),
            status=str(status),
            requestFingerprint=str(request_fingerprint),
            responseMode=str(response_mode),
            invokeConstraints=InvokeConstraintRecord(
                body=ExecutionRepository._payload_dict(invoke_constraints).get("body") or {}
            ),
            expiresAt=to_dt_str(expires_at, "") or "",
            createdAt=to_dt_str(created_at, "") or "",
        )

    @classmethod
    def _invocation_from_row(cls, row: Any) -> InvocationRecord:
        (
            invocation_id,
            quote_id,
            service_id,
            endpoint_id,
            credential_id,
            agent_id,
            idempotency_key,
            request_digest,
            response_mode,
            status,
            charged_usdc,
            error_code,
            error_action,
            upstream_status,
            result_digest,
            result_json,
            started_at,
            finished_at,
            created_at,
            updated_at,
        ) = row
        return InvocationRecord(
            invocationId=str(invocation_id),
            quoteId=str(quote_id),
            serviceId=str(service_id),
            endpointId=str(endpoint_id) if endpoint_id else None,
            credentialId=str(credential_id),
            agentId=str(agent_id),
            idempotencyKey=str(idempotency_key),
            requestDigest=str(request_digest),
            responseMode=str(response_mode),
            status=str(status),
            chargedUsdc=Decimal(str(charged_usdc or 0)),
            errorCode=str(error_code) if error_code else None,
            errorAction=str(error_action) if error_action else None,
            upstreamStatus=int(upstream_status) if upstream_status is not None else None,
            result=InvocationResultRecord(
                digest=str(result_digest) if result_digest else None,
                payload=cls._payload_dict(result_json),
            ),
            startedAt=to_dt_str(started_at),
            finishedAt=to_dt_str(finished_at),
            createdAt=to_dt_str(created_at, "") or "",
            updatedAt=to_dt_str(updated_at, "") or "",
        )

    def read_quote(self, quote_id: str) -> Optional[ServiceQuoteRecord]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT quote_id, service_id, credential_id, agent_id,
                       quoted_price_usdc, price_model, status, request_fingerprint,
                       response_mode, invoke_constraints, expires_at, created_at
                FROM synapse_service_quotes
                WHERE quote_id = %s
                """,
                (quote_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return self._quote_from_row(row)

    def upsert_quote(self, quote: ServiceQuoteRecord) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_service_quotes (
                    quote_id, service_id, credential_id, agent_id,
                    quoted_price_usdc, price_model, status, request_fingerprint,
                    response_mode, invoke_constraints, expires_at, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::synapse_quote_status, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (quote_id)
                DO UPDATE SET
                    status = EXCLUDED.status,
                    invoke_constraints = EXCLUDED.invoke_constraints,
                    expires_at = EXCLUDED.expires_at,
                    created_at = EXCLUDED.created_at
                """,
                (
                    quote.quote_id,
                    quote.service_id,
                    quote.credential_id,
                    quote.agent_id,
                    str(quote.quoted_price_usdc),
                    quote.price_model,
                    quote.status,
                    quote.request_fingerprint,
                    quote.response_mode,
                    json.dumps(quote.invoke_constraints.model_dump(by_alias=True, mode="json")),
                    to_dt_str(quote.expires_at, quote.expires_at),
                    to_dt_str(quote.created_at, quote.created_at),
                ),
            )

    def read_invocation(self, invocation_id: str) -> Optional[InvocationRecord]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT invocation_id, quote_id, service_id, endpoint_id,
                       credential_id, agent_id, idempotency_key, request_digest,
                       response_mode, status, charged_usdc, error_code, error_action,
                       upstream_status, result_digest, result_json, started_at,
                       finished_at, created_at, updated_at
                FROM synapse_invocations
                WHERE invocation_id = %s
                """,
                (invocation_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return self._invocation_from_row(row)

    def read_invocation_by_idempotency(
        self, credential_id: str, idempotency_key: str
    ) -> Optional[InvocationRecord]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT invocation_id, quote_id, service_id, endpoint_id,
                       credential_id, agent_id, idempotency_key, request_digest,
                       response_mode, status, charged_usdc, error_code, error_action,
                       upstream_status, result_digest, result_json, started_at,
                       finished_at, created_at, updated_at
                FROM synapse_invocations
                WHERE credential_id = %s AND idempotency_key = %s
                """,
                (credential_id, idempotency_key),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return self._invocation_from_row(row)

    def upsert_invocation(self, invocation: InvocationRecord) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_invocations (
                    invocation_id, quote_id, service_id, endpoint_id,
                    credential_id, agent_id, idempotency_key, request_digest,
                    response_mode, status, charged_usdc, error_code, error_action,
                    upstream_status, result_digest, result_json, started_at,
                    finished_at, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s::synapse_invocation_status, %s, %s, %s,
                    %s, %s, %s::jsonb, %s, %s, %s, %s
                )
                ON CONFLICT (invocation_id)
                DO UPDATE SET
                    quote_id = EXCLUDED.quote_id,
                    service_id = EXCLUDED.service_id,
                    endpoint_id = EXCLUDED.endpoint_id,
                    credential_id = EXCLUDED.credential_id,
                    agent_id = EXCLUDED.agent_id,
                    idempotency_key = EXCLUDED.idempotency_key,
                    request_digest = EXCLUDED.request_digest,
                    response_mode = EXCLUDED.response_mode,
                    status = EXCLUDED.status,
                    charged_usdc = EXCLUDED.charged_usdc,
                    error_code = EXCLUDED.error_code,
                    error_action = EXCLUDED.error_action,
                    upstream_status = EXCLUDED.upstream_status,
                    result_digest = EXCLUDED.result_digest,
                    result_json = EXCLUDED.result_json,
                    started_at = EXCLUDED.started_at,
                    finished_at = EXCLUDED.finished_at,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    invocation.invocation_id,
                    invocation.quote_id,
                    invocation.service_id,
                    invocation.endpoint_id,
                    invocation.credential_id,
                    invocation.agent_id,
                    invocation.idempotency_key,
                    invocation.request_digest,
                    invocation.response_mode,
                    invocation.status,
                    str(invocation.charged_usdc),
                    invocation.error_code,
                    invocation.error_action,
                    invocation.upstream_status,
                    invocation.result.digest,
                    json.dumps(invocation.result.payload),
                    to_dt_str(invocation.started_at),
                    to_dt_str(invocation.finished_at),
                    to_dt_str(invocation.created_at, invocation.created_at),
                    to_dt_str(invocation.updated_at, invocation.updated_at),
                ),
            )