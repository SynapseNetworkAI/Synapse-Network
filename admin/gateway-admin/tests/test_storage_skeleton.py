from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.domain import AdminApproval, AdminAuditExport, AdminSession, AdminUser
from src.domain.enums import ApprovalLevel, ApprovalStatus
from src.storage import InMemoryAdminStore, PostgresAdminStore


def test_domain_models_are_importable() -> None:
    user = AdminUser(admin_id="adm_1", email="ops@synapse.network", display_name="Ops")
    session = AdminSession(
        session_id="sess_1",
        admin_id=user.admin_id,
        token_jti="jti_1",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    approval = AdminApproval(
        approval_id="APR-20260316-001",
        approval_type="deposit_repair",
        approval_level=ApprovalLevel.L2,
        status=ApprovalStatus.SUBMITTED,
        requester_id=user.admin_id,
        resource_type="deposit_intent",
        resource_id="dep_123",
        reason="ledger repair",
        amount_usdc=Decimal("100.00"),
    )
    audit_export = AdminAuditExport(export_id="exp_1", export_scope="audit_admin")

    assert user.email == "ops@synapse.network"
    assert session.token_jti == "jti_1"
    assert approval.amount_usdc == Decimal("100.00")
    assert audit_export.export_scope == "audit_admin"


def test_postgres_admin_store_wires_repository_skeletons() -> None:
    store = PostgresAdminStore.from_dsn("postgresql://localhost:5432/synapse_gateway_admin")

    assert store.identity.dsn.endswith("synapse_gateway_admin")
    assert store.authorization.dsn.endswith("synapse_gateway_admin")
    assert store.approval.dsn.endswith("synapse_gateway_admin")
    assert store.audit.dsn.endswith("synapse_gateway_admin")


def test_inmemory_store_seeds_bootstrap_data() -> None:
    store = InMemoryAdminStore.seed_demo()

    user = store.identity.get_user_by_email("ops@synapse.network")
    approvals = store.approval.list_approvals(limit=10)

    assert user is not None
    assert approvals[0].approval_id.startswith("APR-")