"""Credential auth repository — runtime credential row helpers."""
from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from src.domain.identity import (
    AgentCredentialRecord,
    AgentProfileRecord,
    BudgetPolicyRecord,
    OwnerAccountRecord,
    RuntimeCredentialRecord,
)
from src.domain.runtime_state import CredentialMetadataState
from src.utils.datetime_utils import now_dt_str, to_dt_str


class CredentialAuthRuntimeMixin:
    """Runtime credential row materialization and read/write helpers."""

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
        return RuntimeCredentialRecord(
            owner=owner,
            agent=agent,
            credential=record.credential,
            policy=record.policy or self._default_runtime_policy(credential_id),
            metadata=record.metadata or self._default_runtime_metadata(record, agent, owner),
        )

    def _default_runtime_policy(self, credential_id: str) -> BudgetPolicyRecord:
        return BudgetPolicyRecord(
            policyId=self._policy_id(credential_id),
            credentialId=credential_id,
            lifetimeCapUsdc=Decimal("0"),
            dailyCapUsdc=Decimal("0"),
            perInvocationCapUsdc=Decimal("0"),
            rpmLimit=0,
            qpsLimit=0,
        )

    def _default_runtime_metadata(
        self,
        record: RuntimeCredentialRecord,
        agent: AgentProfileRecord,
        owner: OwnerAccountRecord,
    ) -> CredentialMetadataState:
        return CredentialMetadataState(
            credentialType=agent.runtime_label,
            ownerAddress=owner.owner_wallet,
            name=agent.name,
            createdAt=to_dt_str(record.credential.issued_at, now_dt_str()),
            updatedAt=to_dt_str(record.credential.last_used_at, record.credential.issued_at),
        )

    def _insert_credential_row(self, cur: Any, record: RuntimeCredentialRecord) -> None:
        normalized = self._materialize_runtime_record(record)
        credential_id = str(normalized.credential.credential_id or "").strip()
        owner_wallet = str(normalized.owner.owner_wallet or "").strip().lower()
        runtime_label = str(normalized.agent.runtime_label or "").strip().lower()
        if not credential_id or not owner_wallet or not runtime_label:
            return
        agent_id = self._ensure_agent_profile(cur, normalized)
        issued_at = to_dt_str(normalized.credential.issued_at, now_dt_str())
        last_used_at = to_dt_str(
            normalized.credential.last_used_at,
            normalized.metadata.updated_at or issued_at,
        )
        self._upsert_credential(cur, normalized, credential_id, agent_id, issued_at, last_used_at)
        self._upsert_credential_policy(cur, normalized.policy, credential_id, issued_at, last_used_at)
        self._upsert_credential_metadata(
            cur, normalized, credential_id, owner_wallet, runtime_label, issued_at, last_used_at
        )

    def _upsert_credential(
        self,
        cur: Any,
        record: RuntimeCredentialRecord,
        credential_id: str,
        agent_id: str,
        issued_at: str,
        last_used_at: str,
    ) -> None:
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
                record.credential.secret_hash,
                record.credential.secret_prefix or "",
                record.credential.status,
                issued_at,
                to_dt_str(record.credential.expires_at),
                to_dt_str(record.credential.revoked_at),
                last_used_at,
            ),
        )

    def _upsert_credential_policy(
        self,
        cur: Any,
        policy: BudgetPolicyRecord,
        credential_id: str,
        issued_at: str,
        last_used_at: str,
    ) -> None:
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

    def _upsert_credential_metadata(
        self,
        cur: Any,
        record: RuntimeCredentialRecord,
        credential_id: str,
        owner_wallet: str,
        runtime_label: str,
        issued_at: str,
        last_used_at: str,
    ) -> None:
        metadata = record.metadata
        self._upsert_runtime_state(
            cur,
            self._credential_state_key(runtime_label, credential_id),
            metadata.model_copy(
                update={
                    "credential_type": runtime_label,
                    "owner_address": owner_wallet,
                    "name": metadata.name or record.agent.name,
                    "created_at": to_dt_str(metadata.created_at, issued_at),
                    "updated_at": to_dt_str(metadata.updated_at, last_used_at),
                }
            ),
            metadata.updated_at or last_used_at,
        )

    def read_credential_rows(self, credential_type: str) -> list[RuntimeCredentialRecord]:
        rows = self._fetch_credential_rows(str(credential_type or "").lower())
        return [self._runtime_record_from_row(row) for row in rows]

    def _fetch_credential_rows(self, credential_type: str) -> list[Any]:
        with self._db.readonly_cursor() as cur:
            cur.execute(self._credential_rows_sql(), (credential_type,))
            return cur.fetchall()

    def _runtime_record_from_row(self, row: Any) -> RuntimeCredentialRecord:
        (
            owner_id, owner_wallet, owner_status, default_currency, owner_created_at,
            owner_updated_at, agent_id, agent_name, agent_purpose, agent_status,
            runtime_label, agent_created_at, agent_updated_at, credential_id,
            secret_hash, secret_prefix, credential_status, issued_at, expires_at,
            revoked_at, last_used_at, policy_id, lifetime_cap_usdc, daily_cap_usdc,
            per_invocation_cap_usdc, rpm_limit, qps_limit, allowed_service_tags,
            allowed_service_ids, blocked_service_ids, payload, metadata_updated_at,
        ) = row
        return RuntimeCredentialRecord(
            owner=self._owner_record_from_row(
                owner_id, owner_wallet, owner_status, default_currency,
                owner_created_at, owner_updated_at,
            ),
            agent=self._agent_record_from_row(
                agent_id, owner_id, agent_name, agent_purpose, agent_status,
                runtime_label, agent_created_at, agent_updated_at,
            ),
            credential=self._credential_record_from_row(
                credential_id, agent_id, secret_hash, secret_prefix, credential_status,
                issued_at, expires_at, revoked_at, last_used_at,
            ),
            policy=self._policy_record_from_row(
                policy_id, credential_id, lifetime_cap_usdc, daily_cap_usdc,
                per_invocation_cap_usdc, rpm_limit, qps_limit, allowed_service_tags,
                allowed_service_ids, blocked_service_ids, issued_at, last_used_at,
            ),
            metadata=self._metadata_from_row(
                payload, runtime_label, owner_wallet, agent_name, issued_at,
                metadata_updated_at, last_used_at,
            ),
        )

    def _owner_record_from_row(
        self, owner_id: str, wallet: str, status: str, currency: str, created: Any, updated: Any
    ) -> OwnerAccountRecord:
        return OwnerAccountRecord(
            ownerId=owner_id,
            ownerWallet=str(wallet).lower(),
            status=status,
            defaultCurrency=currency,
            createdAt=to_dt_str(created),
            updatedAt=to_dt_str(updated),
        )

    def _agent_record_from_row(
        self, agent_id: str, owner_id: str, name: str, purpose: str, status: str,
        runtime_label: str, created: Any, updated: Any,
    ) -> AgentProfileRecord:
        return AgentProfileRecord(
            agentId=agent_id,
            ownerId=owner_id,
            name=name,
            purpose=purpose,
            status=status,
            runtimeLabel=runtime_label,
            createdAt=to_dt_str(created),
            updatedAt=to_dt_str(updated),
        )

    def _credential_record_from_row(
        self, credential_id: str, agent_id: str, secret_hash: str, secret_prefix: str,
        status: str, issued_at: Any, expires_at: Any, revoked_at: Any, last_used_at: Any,
    ) -> AgentCredentialRecord:
        return AgentCredentialRecord(
            credentialId=credential_id,
            agentId=agent_id,
            secretHash=secret_hash,
            secretPrefix=secret_prefix,
            status=status,
            issuedAt=to_dt_str(issued_at),
            expiresAt=to_dt_str(expires_at),
            revokedAt=to_dt_str(revoked_at),
            lastUsedAt=to_dt_str(last_used_at),
        )

    def _policy_record_from_row(
        self,
        policy_id: str,
        credential_id: str,
        lifetime_cap_usdc: Any,
        daily_cap_usdc: Any,
        per_invocation_cap_usdc: Any,
        rpm_limit: Any,
        qps_limit: Any,
        allowed_service_tags: Any,
        allowed_service_ids: Any,
        blocked_service_ids: Any,
        issued_at: Any,
        last_used_at: Any,
    ) -> BudgetPolicyRecord:
        return BudgetPolicyRecord(
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
        )

    def _metadata_from_row(
        self, payload: Any, runtime_label: str, owner_wallet: str, agent_name: str,
        issued_at: Any, metadata_updated_at: Any, last_used_at: Any,
    ) -> CredentialMetadataState | None:
        return self._parse_state_model(
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

    def _credential_rows_sql(self) -> str:
        return """
            SELECT
                oa.owner_id, oa.owner_wallet, oa.status, oa.default_currency,
                oa.created_at, oa.updated_at, ap.agent_id, ap.name, ap.purpose,
                ap.status, ap.runtime_label, ap.created_at, ap.updated_at,
                ac.credential_id, ac.secret_hash, ac.secret_prefix, ac.status,
                ac.issued_at, ac.expires_at, ac.revoked_at,
                COALESCE(ac.last_used_at, rs.updated_at, ac.issued_at),
                bp.policy_id, bp.lifetime_cap_usdc, bp.daily_cap_usdc,
                bp.per_invocation_cap_usdc, bp.rpm_limit, bp.qps_limit,
                bp.allowed_service_tags, bp.allowed_service_ids, bp.blocked_service_ids,
                rs.payload, rs.updated_at
            FROM synapse_agent_credentials AS ac
            INNER JOIN synapse_agent_profiles AS ap ON ap.agent_id = ac.agent_id
            INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = ap.owner_id
            LEFT JOIN synapse_budget_policies AS bp ON bp.credential_id = ac.credential_id
            LEFT JOIN synapse_runtime_state AS rs
                ON rs.state_key = CONCAT('credential_meta::', ap.runtime_label, '::', ac.credential_id)
            WHERE ap.runtime_label = %s
            ORDER BY ac.issued_at DESC
        """
