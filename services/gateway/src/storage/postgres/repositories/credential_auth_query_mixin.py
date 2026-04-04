"""Credential auth repository — auth session and credential row read/write mixin."""
from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Callable, Optional, TypeVar

from pydantic import BaseModel

from src.domain.identity import (
    AgentCredentialRecord,
    AgentProfileRecord,
    BudgetPolicyRecord,
    OwnerAccountRecord,
    OwnerProfileRecord,
    RuntimeCredentialRecord,
)
from src.domain.runtime_state import (
    AuthSessionState,
    CredentialMetadataState,
    WalletRoleState,
)
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager

StateModel = TypeVar("StateModel", bound=BaseModel)



class CredentialAuthQueryMixin:
    """Credential row and auth session operations."""

    def _delete_runtime_credentials(self, cur: Any, credential_type: str) -> None:
        cur.execute(
            "DELETE FROM synapse_runtime_state WHERE state_key LIKE %s",
            (f"credential_meta::{credential_type}::%",),
        )
        cur.execute(
            """
            DELETE FROM synapse_budget_policies AS bp
            USING synapse_agent_credentials AS ac, synapse_agent_profiles AS ap
            WHERE bp.credential_id = ac.credential_id
              AND ac.agent_id = ap.agent_id
              AND ap.runtime_label = %s
            """,
            (credential_type,),
        )
        cur.execute(
            """
            DELETE FROM synapse_agent_credentials AS ac
            USING synapse_agent_profiles AS ap
            WHERE ac.agent_id = ap.agent_id
              AND ap.runtime_label = %s
            """,
            (credential_type,),
        )

    def _materialize_runtime_record(
        self, record: RuntimeCredentialRecord
    ) -> RuntimeCredentialRecord:
        credential_id = str(record.credential.credential_id or "").strip()
        owner_wallet = str(record.owner.owner_wallet or "").strip().lower()
        runtime_label = str(record.agent.runtime_label or "").strip().lower()
        owner = record.owner.model_copy(
            update={
                "owner_id": str(record.owner.owner_id or self._owner_id(owner_wallet)),
                "owner_wallet": owner_wallet,
            }
        )
        agent = record.agent.model_copy(
            update={
                "agent_id": str(
                    record.agent.agent_id or self._agent_id(runtime_label, owner_wallet)
                ),
                "owner_id": owner.owner_id,
                "runtime_label": runtime_label,
            }
        )
        metadata = record.metadata or CredentialMetadataState(
            credentialType=runtime_label,
            ownerAddress=owner_wallet,
            name=agent.name,
            createdAt=to_dt_str(record.credential.issued_at, now_dt_str()),
            updatedAt=to_dt_str(record.credential.last_used_at, record.credential.issued_at),
        )
        policy = record.policy or BudgetPolicyRecord(
            policyId=self._policy_id(credential_id),
            credentialId=credential_id,
            lifetimeCapUsdc=Decimal("0"),
            dailyCapUsdc=Decimal("0"),
            perInvocationCapUsdc=Decimal("0"),
            rpmLimit=0,
            qpsLimit=0,
        )
        return RuntimeCredentialRecord(
            owner=owner,
            agent=agent,
            credential=record.credential,
            policy=policy,
            metadata=metadata,
        )

    def _insert_credential_row(self, cur: Any, record: RuntimeCredentialRecord) -> None:
        normalized = self._materialize_runtime_record(record)
        credential_id = str(normalized.credential.credential_id or "").strip()
        owner_wallet = str(normalized.owner.owner_wallet or "").strip().lower()
        runtime_label = str(normalized.agent.runtime_label or "").strip().lower()
        if not credential_id or not owner_wallet or not runtime_label:
            return

        agent_id = self._ensure_agent_profile(cur, normalized)
        metadata = normalized.metadata
        policy = normalized.policy
        issued_at = to_dt_str(normalized.credential.issued_at, now_dt_str())
        last_used_at = to_dt_str(
            normalized.credential.last_used_at, metadata.updated_at or issued_at
        )

        cur.execute(
            """
            INSERT INTO synapse_agent_credentials (
                credential_id, agent_id, secret_hash, secret_prefix, status,
                issued_at, expires_at, revoked_at, last_used_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (credential_id)
            DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                secret_hash = EXCLUDED.secret_hash,
                secret_prefix = EXCLUDED.secret_prefix,
                status = EXCLUDED.status,
                issued_at = EXCLUDED.issued_at,
                expires_at = EXCLUDED.expires_at,
                revoked_at = EXCLUDED.revoked_at,
                last_used_at = EXCLUDED.last_used_at
            """,
            (
                credential_id,
                agent_id,
                normalized.credential.secret_hash,
                normalized.credential.secret_prefix or "",
                normalized.credential.status,
                issued_at,
                to_dt_str(normalized.credential.expires_at),
                to_dt_str(normalized.credential.revoked_at),
                last_used_at,
            ),
        )
        cur.execute(
            """
            INSERT INTO synapse_budget_policies (
                policy_id, credential_id, lifetime_cap_usdc, daily_cap_usdc,
                per_invocation_cap_usdc, rpm_limit, qps_limit,
                allowed_service_tags, allowed_service_ids, blocked_service_ids,
                created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s)
            ON CONFLICT (policy_id)
            DO UPDATE SET
                credential_id = EXCLUDED.credential_id,
                lifetime_cap_usdc = EXCLUDED.lifetime_cap_usdc,
                daily_cap_usdc = EXCLUDED.daily_cap_usdc,
                per_invocation_cap_usdc = EXCLUDED.per_invocation_cap_usdc,
                rpm_limit = EXCLUDED.rpm_limit,
                qps_limit = EXCLUDED.qps_limit,
                allowed_service_tags = EXCLUDED.allowed_service_tags,
                allowed_service_ids = EXCLUDED.allowed_service_ids,
                blocked_service_ids = EXCLUDED.blocked_service_ids,
                updated_at = EXCLUDED.updated_at
            """,
            (
                str(policy.policy_id or self._policy_id(credential_id)),
                credential_id,
                str(self._q6(policy.lifetime_cap_usdc)),
                str(self._q6(policy.daily_cap_usdc)),
                str(self._q6(policy.per_invocation_cap_usdc)),
                int(policy.rpm_limit or 0),
                int(policy.qps_limit or 0),
                json.dumps(policy.allowed_service_tags),
                json.dumps(policy.allowed_service_ids),
                json.dumps(policy.blocked_service_ids),
                to_dt_str(policy.created_at, issued_at),
                to_dt_str(policy.updated_at, last_used_at),
            ),
        )
        self._upsert_runtime_state(
            cur,
            self._credential_state_key(runtime_label, credential_id),
            metadata.model_copy(
                update={
                    "credential_type": runtime_label,
                    "owner_address": owner_wallet,
                    "name": metadata.name or normalized.agent.name,
                    "created_at": to_dt_str(metadata.created_at, issued_at),
                    "updated_at": to_dt_str(metadata.updated_at, last_used_at),
                }
            ),
            metadata.updated_at or last_used_at,
        )

    def read_credential_rows(self, credential_type: str) -> list[RuntimeCredentialRecord]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    oa.owner_id,
                    oa.owner_wallet,
                    oa.status,
                    oa.default_currency,
                    oa.created_at,
                    oa.updated_at,
                    ap.agent_id,
                    ap.name,
                    ap.purpose,
                    ap.status,
                    ap.runtime_label,
                    ap.created_at,
                    ap.updated_at,
                    ac.credential_id,
                    ac.secret_hash,
                    ac.secret_prefix,
                    ac.status,
                    ac.issued_at,
                    ac.expires_at,
                    ac.revoked_at,
                    COALESCE(ac.last_used_at, rs.updated_at, ac.issued_at),
                    bp.policy_id,
                    bp.lifetime_cap_usdc,
                    bp.daily_cap_usdc,
                    bp.per_invocation_cap_usdc,
                    bp.rpm_limit,
                    bp.qps_limit,
                    bp.allowed_service_tags,
                    bp.allowed_service_ids,
                    bp.blocked_service_ids,
                    rs.payload,
                    rs.updated_at
                FROM synapse_agent_credentials AS ac
                INNER JOIN synapse_agent_profiles AS ap ON ap.agent_id = ac.agent_id
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = ap.owner_id
                LEFT JOIN synapse_budget_policies AS bp ON bp.credential_id = ac.credential_id
                LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('credential_meta::', ap.runtime_label, '::', ac.credential_id)
                WHERE ap.runtime_label = %s
                ORDER BY ac.issued_at DESC
                """,
                (str(credential_type or "").lower(),),
            )
            rows = cur.fetchall()

        result: list[RuntimeCredentialRecord] = []
        for row in rows:
            (
                owner_id,
                owner_wallet,
                owner_status,
                default_currency,
                owner_created_at,
                owner_updated_at,
                agent_id,
                agent_name,
                agent_purpose,
                agent_status,
                runtime_label,
                agent_created_at,
                agent_updated_at,
                credential_id,
                secret_hash,
                secret_prefix,
                credential_status,
                issued_at,
                expires_at,
                revoked_at,
                last_used_at,
                policy_id,
                lifetime_cap_usdc,
                daily_cap_usdc,
                per_invocation_cap_usdc,
                rpm_limit,
                qps_limit,
                allowed_service_tags,
                allowed_service_ids,
                blocked_service_ids,
                payload,
                metadata_updated_at,
            ) = row

            metadata = self._parse_state_model(
                payload,
                CredentialMetadataState,
                fallback={
                    "credentialType": runtime_label,
                    "ownerAddress": owner_wallet,
                    "name": agent_name,
                    "createdAt": to_dt_str(issued_at),
                    "updatedAt": to_dt_str(metadata_updated_at, last_used_at),
                },
            )
            result.append(
                RuntimeCredentialRecord(
                    owner=OwnerAccountRecord(
                        ownerId=owner_id,
                        ownerWallet=str(owner_wallet).lower(),
                        status=owner_status,
                        defaultCurrency=default_currency,
                        createdAt=to_dt_str(owner_created_at),
                        updatedAt=to_dt_str(owner_updated_at),
                    ),
                    agent=AgentProfileRecord(
                        agentId=agent_id,
                        ownerId=owner_id,
                        name=agent_name,
                        purpose=agent_purpose,
                        status=agent_status,
                        runtimeLabel=runtime_label,
                        createdAt=to_dt_str(agent_created_at),
                        updatedAt=to_dt_str(agent_updated_at),
                    ),
                    credential=AgentCredentialRecord(
                        credentialId=credential_id,
                        agentId=agent_id,
                        secretHash=secret_hash,
                        secretPrefix=secret_prefix,
                        status=credential_status,
                        issuedAt=to_dt_str(issued_at),
                        expiresAt=to_dt_str(expires_at),
                        revokedAt=to_dt_str(revoked_at),
                        lastUsedAt=to_dt_str(last_used_at),
                    ),
                    policy=BudgetPolicyRecord(
                        policyId=policy_id or self._policy_id(credential_id),
                        credentialId=credential_id,
                        lifetimeCapUsdc=self._q6(lifetime_cap_usdc or Decimal("0")),
                        dailyCapUsdc=self._q6(daily_cap_usdc or Decimal("0")),
                        perInvocationCapUsdc=self._q6(per_invocation_cap_usdc or Decimal("0")),
                        rpmLimit=int(rpm_limit or 0),
                        qpsLimit=int(qps_limit or 0),
                        allowedServiceTags=self._string_list(allowed_service_tags),
                        allowedServiceIds=self._string_list(allowed_service_ids),
                        blockedServiceIds=self._string_list(blocked_service_ids),
                        createdAt=to_dt_str(issued_at),
                        updatedAt=to_dt_str(last_used_at),
                    ),
                    metadata=metadata,
                )
            )
        return result

    def write_credential_rows(
        self, credential_type: str, rows: list[RuntimeCredentialRecord]
    ) -> None:
        normalized_type = str(credential_type or "").lower()
        normalized_rows = [
            row.model_copy(
                update={
                    "owner": row.owner.model_copy(
                        update={
                            "owner_id": str(
                                row.owner.owner_id
                                or self._owner_id(row.owner.owner_wallet)
                            ),
                            "owner_wallet": str(row.owner.owner_wallet or "").lower(),
                        }
                    ),
                    "agent": row.agent.model_copy(
                        update={
                            "agent_id": str(
                                row.agent.agent_id
                                or self._agent_id(normalized_type, row.owner.owner_wallet)
                            ),
                            "owner_id": str(
                                row.owner.owner_id
                                or self._owner_id(row.owner.owner_wallet)
                            ),
                            "runtime_label": normalized_type,
                        }
                    ),
                }
            )
            for row in rows
        ]
        credential_ids = [
            str(row.credential.credential_id or "").strip()
            for row in normalized_rows
            if str(row.credential.credential_id or "").strip()
        ]
        with self._db.tx_cursor() as cur:
            self._delete_obsolete_runtime_credential_state(
                cur, normalized_type, credential_ids
            )
            self._delete_obsolete_runtime_budget_policies(
                cur, normalized_type, credential_ids
            )
            self._delete_obsolete_runtime_credentials(
                cur, normalized_type, credential_ids
            )
            for row in normalized_rows:
                self._insert_credential_row(cur, row)

    def upsert_auth_session(
        self, wallet: str, registered_at: int, last_login: int, status: str
    ) -> None:
        self.save_auth_session(
            AuthSessionState(
                walletAddress=str(wallet or "").lower(),
                registeredAt=int(registered_at),
                lastLogin=int(last_login),
                status=str(status or "active"),
                updatedAt=now_dt_str(),
            )
        )

    def read_auth_session(self, wallet: str) -> Optional[AuthSessionState]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
                (self._auth_session_state_key(wallet),),
            )
            row = cur.fetchone()
        if row is None:
            return None
        payload = row
        if isinstance(row, (list, tuple)) and row:
            payload = row[0]
        return self._parse_state_model(
            payload,
            AuthSessionState,
            fallback={
                "walletAddress": str(wallet or "").lower(),
                "registeredAt": 0,
                "lastLogin": 0,
                "status": "active",
            },
        )

    def save_auth_session(self, row: AuthSessionState) -> None:
        now = now_dt_str()
        wallet = str(row.wallet_address or "").lower()
        existing = self.read_auth_session(wallet)
        registered_at = int(row.registered_at)
        if existing is not None and int(existing.registered_at or 0) > 0:
            registered_at = min(int(existing.registered_at), registered_at)
        normalized = row.model_copy(
            update={
                "wallet_address": wallet,
                "registered_at": registered_at,
                "updated_at": to_dt_str(row.updated_at or now, now),
            }
        )
        with self._db.tx_cursor() as cur:
            self._upsert_runtime_state(
                cur,
                self._auth_session_state_key(wallet),
                normalized,
                normalized.updated_at,
            )
