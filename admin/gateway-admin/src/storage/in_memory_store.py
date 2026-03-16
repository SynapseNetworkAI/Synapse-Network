from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from itertools import count

from src.domain import (
    AdminActionAudit,
    AdminApproval,
    AdminApprovalEvent,
    AdminApprovalStep,
    AdminAuditExport,
    AdminExecutionAttempt,
    AdminExecutionJob,
    AdminMfaFactor,
    AdminPermission,
    AdminRole,
    AdminRolePermission,
    AdminSession,
    AdminUser,
    AdminUserRoleBinding,
)
from src.domain.enums import (
    AdminSessionStatus,
    AdminUserStatus,
    ApprovalLevel,
    ApprovalStatus,
    AuditExportStatus,
    AuditResultStatus,
    MfaFactorStatus,
    MfaFactorType,
    PermissionRiskLevel,
    RiskLevel,
    RoleBindingStatus,
    RoleStatus,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


DASHBOARD_READ = "dashboard:read"
APPROVAL_READ = "approval:read"
APPROVAL_SUBMIT = "approval:submit"
APPROVAL_DECIDE = "approval:decide"
AUDIT_READ = "audit:read"


class InMemoryAdminIdentityRepository:
    def __init__(self, users: dict[str, AdminUser], factors: list[AdminMfaFactor], sessions: dict[str, AdminSession]) -> None:
        self._users = users
        self._factors = factors
        self._sessions = sessions

    def get_user_by_id(self, admin_id: str) -> AdminUser | None:
        return self._users.get(admin_id)

    def get_user_by_email(self, email: str) -> AdminUser | None:
        normalized = email.strip().lower()
        for user in self._users.values():
            if user.email.lower() == normalized:
                return user
        return None

    def list_mfa_factors(self, admin_id: str) -> list[AdminMfaFactor]:
        return [factor for factor in self._factors if factor.admin_id == admin_id]

    def get_session_by_id(self, session_id: str) -> AdminSession | None:
        return self._sessions.get(session_id)

    def create_session(self, session: AdminSession) -> AdminSession:
        self._sessions[session.session_id] = session
        return session

    def revoke_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        self._sessions[session_id] = replace(
            session,
            status=AdminSessionStatus.REVOKED,
            revoked_at=_utcnow(),
        )

    def touch_last_login(self, admin_id: str) -> None:
        user = self._users.get(admin_id)
        if user is None:
            return
        self._users[admin_id] = replace(user, last_login_at=_utcnow(), updated_at=_utcnow())


class InMemoryAdminAuthorizationRepository:
    def __init__(
        self,
        roles: dict[str, AdminRole],
        permissions: dict[str, AdminPermission],
        role_permissions: list[AdminRolePermission],
        role_bindings: list[AdminUserRoleBinding],
    ) -> None:
        self._roles = roles
        self._permissions = permissions
        self._role_permissions = role_permissions
        self._role_bindings = role_bindings

    def list_roles(self) -> list[AdminRole]:
        return list(self._roles.values())

    def list_permissions(self) -> list[AdminPermission]:
        return list(self._permissions.values())

    def list_role_permissions(self, role_key: str) -> list[AdminRolePermission]:
        return [mapping for mapping in self._role_permissions if mapping.role_key == role_key]

    def list_role_bindings(self, admin_id: str) -> list[AdminUserRoleBinding]:
        return [binding for binding in self._role_bindings if binding.admin_id == admin_id]


class InMemoryAdminApprovalRepository:
    def __init__(
        self,
        approvals: dict[str, AdminApproval],
        steps: dict[str, list[AdminApprovalStep]],
        events: dict[str, list[AdminApprovalEvent]],
        jobs: dict[str, AdminExecutionJob],
        attempts: dict[str, list[AdminExecutionAttempt]],
    ) -> None:
        self._approvals = approvals
        self._steps = steps
        self._events = events
        self._jobs = jobs
        self._attempts = attempts

    def list_approvals(self, status: str | None = None, approval_type: str | None = None, limit: int = 20) -> list[AdminApproval]:
        items = sorted(self._approvals.values(), key=lambda item: item.created_at or _utcnow(), reverse=True)
        if status:
            items = [item for item in items if item.status.value == status]
        if approval_type:
            items = [item for item in items if item.approval_type == approval_type]
        return items[:limit]

    def count_pending_approvals(self) -> int:
        return len([item for item in self._approvals.values() if item.status != ApprovalStatus.EXECUTED])

    def get_approval(self, approval_id: str) -> AdminApproval | None:
        return self._approvals.get(approval_id)

    def list_approval_steps(self, approval_id: str) -> list[AdminApprovalStep]:
        return sorted(self._steps.get(approval_id, []), key=lambda step: step.step_no)

    def create_approval(self, approval: AdminApproval) -> AdminApproval:
        return self._save_approval(approval)

    def update_approval(self, approval: AdminApproval) -> AdminApproval:
        return self._save_approval(approval)

    def _save_approval(self, approval: AdminApproval) -> AdminApproval:
        self._approvals[approval.approval_id] = approval
        return approval

    def upsert_approval_step(self, step: AdminApprovalStep) -> AdminApprovalStep:
        items = self._steps.setdefault(step.approval_id, [])
        for index, current in enumerate(items):
            if current.step_id == step.step_id or current.step_no == step.step_no:
                items[index] = step
                break
        else:
            items.append(step)
        return step

    def append_approval_event(self, event: AdminApprovalEvent) -> AdminApprovalEvent:
        self._events.setdefault(event.approval_id, []).append(event)
        return event

    def enqueue_execution_job(self, job: AdminExecutionJob) -> AdminExecutionJob:
        self._jobs[job.job_id] = job
        return job

    def append_execution_attempt(self, attempt: AdminExecutionAttempt) -> AdminExecutionAttempt:
        self._attempts.setdefault(attempt.job_id, []).append(attempt)
        return attempt


class InMemoryAdminAuditRepository:
    def __init__(self, actions: list[AdminActionAudit], exports: list[AdminAuditExport]) -> None:
        self._actions = actions
        self._exports = exports

    def append_action(self, audit: AdminActionAudit) -> AdminActionAudit:
        self._actions.append(audit)
        return audit

    def record_export(self, audit_export: AdminAuditExport) -> AdminAuditExport:
        self._exports.append(audit_export)
        return audit_export


@dataclass(slots=True)
class InMemoryAdminStore:
    identity: InMemoryAdminIdentityRepository
    authorization: InMemoryAdminAuthorizationRepository
    approval: InMemoryAdminApprovalRepository
    audit: InMemoryAdminAuditRepository

    @classmethod
    def seed_demo(cls) -> "InMemoryAdminStore":
        now = _utcnow()
        roles = {
            "super_admin": AdminRole("super_admin", "Super Admin", status=RoleStatus.ACTIVE),
            "platform_ops_admin": AdminRole("platform_ops_admin", "Platform Ops Admin", status=RoleStatus.ACTIVE),
            "finance_admin": AdminRole("finance_admin", "Finance Admin", status=RoleStatus.ACTIVE),
            "finance_reviewer": AdminRole("finance_reviewer", "Finance Reviewer", status=RoleStatus.ACTIVE),
            "risk_admin": AdminRole("risk_admin", "Risk Admin", status=RoleStatus.ACTIVE),
            "risk_reviewer": AdminRole("risk_reviewer", "Risk Reviewer", status=RoleStatus.ACTIVE),
            "compliance_auditor": AdminRole("compliance_auditor", "Compliance Auditor", status=RoleStatus.ACTIVE),
            "readonly_analyst": AdminRole("readonly_analyst", "Readonly Analyst", status=RoleStatus.ACTIVE),
        }
        permissions = {
            DASHBOARD_READ: AdminPermission(DASHBOARD_READ, "dashboard", "read", PermissionRiskLevel.LOW),
            APPROVAL_READ: AdminPermission(APPROVAL_READ, "approval", "read", PermissionRiskLevel.MEDIUM),
            APPROVAL_SUBMIT: AdminPermission(APPROVAL_SUBMIT, "approval", "submit", PermissionRiskLevel.HIGH),
            APPROVAL_DECIDE: AdminPermission(APPROVAL_DECIDE, "approval", "decide", PermissionRiskLevel.CRITICAL),
            AUDIT_READ: AdminPermission(AUDIT_READ, "audit", "read", PermissionRiskLevel.HIGH),
        }
        role_permissions = [
            AdminRolePermission("super_admin", DASHBOARD_READ),
            AdminRolePermission("super_admin", APPROVAL_READ),
            AdminRolePermission("super_admin", APPROVAL_SUBMIT),
            AdminRolePermission("super_admin", APPROVAL_DECIDE),
            AdminRolePermission("super_admin", AUDIT_READ),
            AdminRolePermission("platform_ops_admin", DASHBOARD_READ),
            AdminRolePermission("platform_ops_admin", APPROVAL_READ),
            AdminRolePermission("finance_admin", DASHBOARD_READ),
            AdminRolePermission("finance_admin", APPROVAL_READ),
            AdminRolePermission("finance_admin", APPROVAL_SUBMIT),
            AdminRolePermission("finance_reviewer", DASHBOARD_READ),
            AdminRolePermission("finance_reviewer", APPROVAL_READ),
            AdminRolePermission("finance_reviewer", APPROVAL_DECIDE),
            AdminRolePermission("risk_admin", DASHBOARD_READ),
            AdminRolePermission("risk_admin", APPROVAL_READ),
            AdminRolePermission("risk_admin", APPROVAL_SUBMIT),
            AdminRolePermission("risk_reviewer", DASHBOARD_READ),
            AdminRolePermission("risk_reviewer", APPROVAL_READ),
            AdminRolePermission("risk_reviewer", APPROVAL_DECIDE),
            AdminRolePermission("compliance_auditor", DASHBOARD_READ),
            AdminRolePermission("compliance_auditor", APPROVAL_READ),
            AdminRolePermission("compliance_auditor", AUDIT_READ),
            AdminRolePermission("readonly_analyst", DASHBOARD_READ),
        ]
        users = {
            "adm_super_admin": AdminUser("adm_super_admin", "super@synapse.network", "Super Admin", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_platform_ops_admin": AdminUser("adm_platform_ops_admin", "ops@synapse.network", "Platform Ops Admin", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_finance_admin": AdminUser("adm_finance_admin", "finance@synapse.network", "Finance Admin", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_finance_reviewer": AdminUser("adm_finance_reviewer", "finance-review@synapse.network", "Finance Reviewer", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_risk_admin": AdminUser("adm_risk_admin", "risk@synapse.network", "Risk Admin", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_risk_reviewer": AdminUser("adm_risk_reviewer", "risk-review@synapse.network", "Risk Reviewer", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_compliance_auditor": AdminUser("adm_compliance_auditor", "audit@synapse.network", "Compliance Auditor", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
            "adm_readonly_analyst": AdminUser("adm_readonly_analyst", "readonly@synapse.network", "Readonly Analyst", status=AdminUserStatus.ACTIVE, created_at=now, updated_at=now),
        }
        factors = [
            AdminMfaFactor(f"mfa_{user.admin_id}", user.admin_id, MfaFactorType.TOTP, "bootstrap_totp", status=MfaFactorStatus.ACTIVE, secret_ref=f"kms://{user.admin_id}")
            for user in users.values()
        ]
        role_bindings = [
            AdminUserRoleBinding("bind_super_admin", "adm_super_admin", "super_admin", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_platform_ops_admin", "adm_platform_ops_admin", "platform_ops_admin", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_finance_admin", "adm_finance_admin", "finance_admin", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_finance_reviewer", "adm_finance_reviewer", "finance_reviewer", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_risk_admin", "adm_risk_admin", "risk_admin", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_risk_reviewer", "adm_risk_reviewer", "risk_reviewer", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_compliance_auditor", "adm_compliance_auditor", "compliance_auditor", status=RoleBindingStatus.ACTIVE),
            AdminUserRoleBinding("bind_readonly_analyst", "adm_readonly_analyst", "readonly_analyst", status=RoleBindingStatus.ACTIVE),
        ]
        approvals = {
            "APR-20260316-001": AdminApproval(
                approval_id="APR-20260316-001",
                approval_type="refund_approve",
                approval_level=ApprovalLevel.L2,
                status=ApprovalStatus.UNDER_REVIEW,
                requester_id="adm_finance_admin",
                resource_type="refund_intent",
                resource_id="ref_001",
                reason="refund pending manual review",
                amount_usdc=Decimal("150.00"),
                risk_level=RiskLevel.YELLOW,
                created_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=1),
                updated_at=now - timedelta(hours=1),
            ),
            "APR-20260316-002": AdminApproval(
                approval_id="APR-20260316-002",
                approval_type="risk_rule_change",
                approval_level=ApprovalLevel.L3,
                status=ApprovalStatus.APPROVED_PENDING_EXECUTION,
                requester_id="adm_risk_admin",
                resource_type="risk_rule",
                resource_id="rule_001",
                reason="tighten withdrawal threshold",
                amount_usdc=Decimal("0.00"),
                risk_level=RiskLevel.RED,
                created_at=now - timedelta(minutes=30),
                submitted_at=now - timedelta(minutes=30),
                approved_at=now - timedelta(minutes=10),
                updated_at=now - timedelta(minutes=10),
            ),
        }
        steps = {
            "APR-20260316-001": [AdminApprovalStep("step_apr_1", "APR-20260316-001", 1, required_permission=APPROVAL_DECIDE, created_at=now - timedelta(hours=1))],
            "APR-20260316-002": [
                AdminApprovalStep(
                    "step_apr_2",
                    "APR-20260316-002",
                    1,
                    required_permission=APPROVAL_DECIDE,
                    approver_id="adm_risk_reviewer",
                    created_at=now - timedelta(minutes=30),
                )
            ],
        }
        return cls(
            identity=InMemoryAdminIdentityRepository(users, factors, {}),
            authorization=InMemoryAdminAuthorizationRepository(roles, permissions, role_permissions, role_bindings),
            approval=InMemoryAdminApprovalRepository(approvals, steps, {}, {}, {}),
            audit=InMemoryAdminAuditRepository([], []),
        )