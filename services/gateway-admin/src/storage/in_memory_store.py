from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.domain import (
    AdminActionAudit,
    AdminApproval,
    AdminApprovalEvent,
    AdminApprovalStep,
    AdminAuditExport,
    AdminExecutionAttempt,
    AdminExecutionJob,
    AdminMfaEnrollmentChallenge,
    AdminMfaFactor,
    AdminMenuConfigItem,
    AdminMenuConfigSnapshot,
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
    ApprovalDecision,
    ApprovalLevel,
    ApprovalStatus,
    AuditExportStatus,
    AuditResultStatus,
    ExecutionAttemptStatus,
    ExecutionJobStatus,
    MfaEnrollmentChallengeStatus,
    MfaFactorStatus,
    MfaFactorType,
    PermissionRiskLevel,
    RiskLevel,
    RoleBindingStatus,
    RoleStatus,
)
from src.services.admin_config.menu_tree import build_default_menu_items


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


DASHBOARD_READ = "dashboard:read"
APPROVAL_READ = "approval:read"
APPROVAL_SUBMIT = "approval:submit"
APPROVAL_DECIDE = "approval:decide"
AUDIT_READ = "audit:read"
EXECUTION_READ = "execution:read"
EXECUTION_RETRY = "execution:retry"
SUPPORT_READ = "support:read"
SUPPORT_REPLY = "support:reply"
SUPPORT_TRIAGE = "support:triage"


class InMemoryAdminConfigRepository:
    def __init__(self, menu_snapshot: AdminMenuConfigSnapshot | None = None) -> None:
        self._menu_snapshot = menu_snapshot

    def get_menu_config(self, config_key: str) -> AdminMenuConfigSnapshot | None:
        if self._menu_snapshot is None or self._menu_snapshot.config_key != config_key:
            return None
        return self._menu_snapshot

    def save_menu_config(self, snapshot: AdminMenuConfigSnapshot) -> AdminMenuConfigSnapshot:
        self._menu_snapshot = snapshot
        return snapshot


class InMemoryAdminIdentityRepository:
    def __init__(
        self,
        users: dict[str, AdminUser],
        factors: list[AdminMfaFactor],
        challenges: dict[str, AdminMfaEnrollmentChallenge],
        sessions: dict[str, AdminSession],
    ) -> None:
        self._users = users
        self._factors = factors
        self._challenges = challenges
        self._sessions = sessions

    def get_user_by_id(self, admin_id: str) -> AdminUser | None:
        return self._users.get(admin_id)

    def get_user_by_email(self, email: str) -> AdminUser | None:
        normalized = email.strip().lower()
        for user in self._users.values():
            if user.email.lower() == normalized:
                return user
        return None

    def list_users(self, status: str | None = None, limit: int = 100) -> list[AdminUser]:
        items = sorted(
            self._users.values(),
            key=lambda user: (user.updated_at or _utcnow(), user.admin_id),
            reverse=True,
        )
        if status:
            items = [user for user in items if user.status.value == status]
        return items[:limit]

    def create_user(self, user: AdminUser) -> AdminUser:
        return self._store_user(user)

    def update_user(self, user: AdminUser) -> AdminUser:
        return self._store_user(user)

    def _store_user(self, user: AdminUser) -> AdminUser:
        self._users[user.admin_id] = user
        return user

    def update_password_hash(self, admin_id: str, password_hash: str) -> None:
        user = self._users.get(admin_id)
        if user is None:
            return
        self._users[admin_id] = replace(user, password_hash=password_hash, updated_at=_utcnow())

    def list_mfa_factors(self, admin_id: str) -> list[AdminMfaFactor]:
        return [factor for factor in self._factors if factor.admin_id == admin_id]

    def get_mfa_factor_by_id(self, factor_id: str) -> AdminMfaFactor | None:
        for factor in self._factors:
            if factor.factor_id == factor_id:
                return factor
        return None

    def get_mfa_factor_by_identity(self, admin_id: str, factor_type: str, factor_label: str) -> AdminMfaFactor | None:
        for factor in self._factors:
            if factor.admin_id != admin_id:
                continue
            if factor.factor_type.value != factor_type:
                continue
            if factor.factor_label != factor_label:
                continue
            return factor
        return None

    def upsert_mfa_factor(self, factor: AdminMfaFactor) -> AdminMfaFactor:
        for index, current in enumerate(self._factors):
            if current.factor_id == factor.factor_id:
                self._factors[index] = factor
                break
        else:
            self._factors.append(factor)
        return factor

    def list_mfa_enrollment_challenges(self, admin_id: str) -> list[AdminMfaEnrollmentChallenge]:
        return [challenge for challenge in self._challenges.values() if challenge.admin_id == admin_id]

    def get_mfa_enrollment_challenge_by_token_hash(self, token_hash: str) -> AdminMfaEnrollmentChallenge | None:
        for challenge in self._challenges.values():
            if challenge.challenge_token_hash == token_hash:
                return challenge
        return None

    def upsert_mfa_enrollment_challenge(self, challenge: AdminMfaEnrollmentChallenge) -> AdminMfaEnrollmentChallenge:
        self._challenges[challenge.challenge_id] = challenge
        return challenge

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

    def get_role(self, role_key: str) -> AdminRole | None:
        return self._roles.get(role_key)

    def create_role(self, role: AdminRole) -> AdminRole:
        return self._store_role(role)

    def update_role(self, role: AdminRole) -> AdminRole:
        return self._store_role(role)

    def _store_role(self, role: AdminRole) -> AdminRole:
        self._roles[role.role_key] = role
        return role

    def list_permissions(self) -> list[AdminPermission]:
        return list(self._permissions.values())

    def list_role_permissions(self, role_key: str) -> list[AdminRolePermission]:
        return [mapping for mapping in self._role_permissions if mapping.role_key == role_key]

    def replace_role_permissions(self, role_key: str, permissions: list[AdminRolePermission]) -> list[AdminRolePermission]:
        self._role_permissions = [mapping for mapping in self._role_permissions if mapping.role_key != role_key]
        self._role_permissions.extend(permissions)
        return permissions

    def list_role_bindings(self, admin_id: str) -> list[AdminUserRoleBinding]:
        return [binding for binding in self._role_bindings if binding.admin_id == admin_id]

    def create_role_binding(self, binding: AdminUserRoleBinding) -> AdminUserRoleBinding:
        self._role_bindings.append(binding)
        return binding

    def replace_role_bindings(
        self,
        admin_id: str,
        bindings: list[AdminUserRoleBinding],
    ) -> list[AdminUserRoleBinding]:
        updated_bindings: list[AdminUserRoleBinding] = []
        for binding in self._role_bindings:
            if binding.admin_id == admin_id and binding.status == RoleBindingStatus.ACTIVE:
                updated_bindings.append(replace(binding, status=RoleBindingStatus.REVOKED, updated_at=_utcnow()))
            else:
                updated_bindings.append(binding)
        updated_bindings.extend(bindings)
        self._role_bindings = updated_bindings
        return bindings


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

    def count_approvals(self, statuses: list[str] | None = None, approval_type: str | None = None) -> int:
        items = list(self._approvals.values())
        if statuses:
            items = [item for item in items if item.status.value in statuses]
        if approval_type:
            items = [item for item in items if item.approval_type == approval_type]
        return len(items)

    def sum_approval_amount(self, statuses: list[str] | None = None, approval_type: str | None = None) -> Decimal:
        items = list(self._approvals.values())
        if statuses:
            items = [item for item in items if item.status.value in statuses]
        if approval_type:
            items = [item for item in items if item.approval_type == approval_type]
        return sum((item.amount_usdc for item in items), Decimal("0"))

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
        return self._save_execution_job(job)

    def list_execution_jobs(
        self,
        status: str | None = None,
        target_system: str | None = None,
        approval_id: str | None = None,
        limit: int = 20,
    ) -> list[AdminExecutionJob]:
        items = sorted(self._jobs.values(), key=lambda item: item.created_at or _utcnow(), reverse=True)
        if status:
            items = [item for item in items if item.status.value == status]
        if target_system:
            items = [item for item in items if item.target_system == target_system]
        if approval_id:
            items = [item for item in items if item.approval_id == approval_id]
        return items[:limit]

    def get_execution_job(self, job_id: str) -> AdminExecutionJob | None:
        return self._jobs.get(job_id)

    def claim_execution_job(
        self,
        job_id: str,
        from_statuses: list[str],
        claimed_job: AdminExecutionJob,
    ) -> AdminExecutionJob | None:
        current = self._jobs.get(job_id)
        if current is None or current.status.value not in from_statuses:
            return None
        return self._save_execution_job(claimed_job)

    def update_execution_job(self, job: AdminExecutionJob) -> AdminExecutionJob:
        return self._save_execution_job(job)

    def _save_execution_job(self, job: AdminExecutionJob) -> AdminExecutionJob:
        self._jobs[job.job_id] = job
        return job

    def list_execution_attempts(self, job_id: str) -> list[AdminExecutionAttempt]:
        return sorted(self._attempts.get(job_id, []), key=lambda item: item.attempt_no, reverse=True)

    def append_execution_attempt(self, attempt: AdminExecutionAttempt) -> AdminExecutionAttempt:
        self._attempts.setdefault(attempt.job_id, []).append(attempt)
        return attempt

    def update_execution_attempt(self, attempt: AdminExecutionAttempt) -> AdminExecutionAttempt:
        attempts = self._attempts.setdefault(attempt.job_id, [])
        for index, current in enumerate(attempts):
            if current.attempt_id == attempt.attempt_id or current.attempt_no == attempt.attempt_no:
                attempts[index] = attempt
                break
        else:
            attempts.append(attempt)
        return attempt

    def latest_activity_at(self) -> datetime | None:
        timestamps = [
            *(item.updated_at for item in self._approvals.values() if item.updated_at is not None),
            *(item.updated_at for item in self._jobs.values() if item.updated_at is not None),
        ]
        return max(timestamps) if timestamps else None


class InMemoryAdminAuditRepository:
    def __init__(self, actions: list[AdminActionAudit], exports: list[AdminAuditExport]) -> None:
        self._actions = actions
        self._exports = exports

    def append_action(self, audit: AdminActionAudit) -> AdminActionAudit:
        self._actions.append(audit)
        return audit

    def list_actions(
        self,
        action_type: str | None = None,
        result_status: str | None = None,
        operator_id: str | None = None,
        approval_id: str | None = None,
        job_id: str | None = None,
        limit: int = 50,
    ) -> list[AdminActionAudit]:
        items = sorted(self._actions, key=lambda item: item.created_at or _utcnow(), reverse=True)
        if action_type:
            items = [item for item in items if item.action_type == action_type]
        if result_status:
            items = [item for item in items if item.result_status.value == result_status]
        if operator_id:
            items = [item for item in items if item.operator_id == operator_id]
        if approval_id:
            items = [item for item in items if item.approval_id == approval_id]
        if job_id:
            items = [item for item in items if item.job_id == job_id]
        return items[:limit]

    def count_alerts(self) -> int:
        return len([item for item in self._actions if item.result_status in {AuditResultStatus.FAILURE, AuditResultStatus.DENIED}])

    def latest_activity_at(self) -> datetime | None:
        timestamps = [item.created_at for item in self._actions if item.created_at is not None]
        return max(timestamps) if timestamps else None

    def record_export(self, audit_export: AdminAuditExport) -> AdminAuditExport:
        self._exports.append(audit_export)
        return audit_export


@dataclass(slots=True)
class InMemoryAdminStore:
    identity: InMemoryAdminIdentityRepository
    authorization: InMemoryAdminAuthorizationRepository
    approval: InMemoryAdminApprovalRepository
    audit: InMemoryAdminAuditRepository
    config: InMemoryAdminConfigRepository

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
            EXECUTION_READ: AdminPermission(EXECUTION_READ, "execution", "read", PermissionRiskLevel.MEDIUM),
            EXECUTION_RETRY: AdminPermission(EXECUTION_RETRY, "execution", "retry", PermissionRiskLevel.HIGH),
            SUPPORT_READ: AdminPermission(SUPPORT_READ, "support", "read", PermissionRiskLevel.MEDIUM),
            SUPPORT_REPLY: AdminPermission(SUPPORT_REPLY, "support", "reply", PermissionRiskLevel.HIGH),
            SUPPORT_TRIAGE: AdminPermission(SUPPORT_TRIAGE, "support", "triage", PermissionRiskLevel.MEDIUM),
        }
        role_permissions = [
            AdminRolePermission("super_admin", DASHBOARD_READ),
            AdminRolePermission("super_admin", APPROVAL_READ),
            AdminRolePermission("super_admin", APPROVAL_SUBMIT),
            AdminRolePermission("super_admin", APPROVAL_DECIDE),
            AdminRolePermission("super_admin", AUDIT_READ),
            AdminRolePermission("super_admin", EXECUTION_READ),
            AdminRolePermission("super_admin", EXECUTION_RETRY),
            AdminRolePermission("super_admin", SUPPORT_READ),
            AdminRolePermission("super_admin", SUPPORT_REPLY),
            AdminRolePermission("super_admin", SUPPORT_TRIAGE),
            AdminRolePermission("platform_ops_admin", DASHBOARD_READ),
            AdminRolePermission("platform_ops_admin", APPROVAL_READ),
            AdminRolePermission("platform_ops_admin", EXECUTION_READ),
            AdminRolePermission("platform_ops_admin", EXECUTION_RETRY),
            AdminRolePermission("platform_ops_admin", SUPPORT_READ),
            AdminRolePermission("platform_ops_admin", SUPPORT_REPLY),
            AdminRolePermission("platform_ops_admin", SUPPORT_TRIAGE),
            AdminRolePermission("finance_admin", DASHBOARD_READ),
            AdminRolePermission("finance_admin", APPROVAL_READ),
            AdminRolePermission("finance_admin", APPROVAL_SUBMIT),
            AdminRolePermission("finance_reviewer", DASHBOARD_READ),
            AdminRolePermission("finance_reviewer", APPROVAL_READ),
            AdminRolePermission("finance_reviewer", APPROVAL_DECIDE),
            AdminRolePermission("finance_reviewer", EXECUTION_READ),
            AdminRolePermission("finance_reviewer", EXECUTION_RETRY),
            AdminRolePermission("risk_admin", DASHBOARD_READ),
            AdminRolePermission("risk_admin", APPROVAL_READ),
            AdminRolePermission("risk_admin", APPROVAL_SUBMIT),
            AdminRolePermission("risk_reviewer", DASHBOARD_READ),
            AdminRolePermission("risk_reviewer", APPROVAL_READ),
            AdminRolePermission("risk_reviewer", APPROVAL_DECIDE),
            AdminRolePermission("risk_reviewer", EXECUTION_READ),
            AdminRolePermission("risk_reviewer", EXECUTION_RETRY),
            AdminRolePermission("compliance_auditor", DASHBOARD_READ),
            AdminRolePermission("compliance_auditor", APPROVAL_READ),
            AdminRolePermission("compliance_auditor", AUDIT_READ),
            AdminRolePermission("compliance_auditor", SUPPORT_READ),
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
            AdminMfaFactor(
                f"mfa_{user.admin_id}",
                user.admin_id,
                MfaFactorType.TOTP,
                "bootstrap_totp",
                status=MfaFactorStatus.ACTIVE,
                secret_ref=f"kms://{user.admin_id}",
                payload={"totpSecret": "JBSWY3DPEHPK3PXP"},
            )
            for user in users.values()
        ]
        challenges: dict[str, AdminMfaEnrollmentChallenge] = {}
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
        menu_items = build_default_menu_items()
        menu_snapshot = AdminMenuConfigSnapshot(
            config_key="admin_menu_config",
            draft_items=menu_items,
            published_items=menu_items,
            draft_version=1,
            published_version=1,
            created_at=now,
            updated_at=now,
            updated_by="system_seed",
            published_at=now,
            published_by="system_seed",
        )
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
                owner_address="0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
                amount_usdc=Decimal("150.00"),
                risk_level=RiskLevel.YELLOW,
                request_id="refund-review-001",
                tx_hash="0xref001",
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
            "APR-20260316-003": AdminApproval(
                approval_id="APR-20260316-003",
                approval_type="deposit_repair",
                approval_level=ApprovalLevel.L2,
                status=ApprovalStatus.FAILED,
                requester_id="adm_platform_ops_admin",
                resource_type="deposit_intent",
                resource_id="dep_003",
                reason="replay deposit ledger repair",
                owner_address="0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
                amount_usdc=Decimal("42.50"),
                risk_level=RiskLevel.YELLOW,
                tx_hash="0xdep003",
                request_id="dep-repair-003",
                created_at=now - timedelta(minutes=20),
                submitted_at=now - timedelta(minutes=20),
                updated_at=now - timedelta(minutes=5),
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
            "APR-20260316-003": [
                AdminApprovalStep(
                    "step_apr_3",
                    "APR-20260316-003",
                    1,
                    required_permission=APPROVAL_DECIDE,
                    approver_id="adm_finance_reviewer",
                    decision=ApprovalDecision.APPROVE,
                    created_at=now - timedelta(minutes=20),
                    decided_at=now - timedelta(minutes=18),
                )
            ],
        }
        jobs = {
            "job_apr_2": AdminExecutionJob(
                job_id="job_apr_2",
                approval_id="APR-20260316-002",
                execution_type="risk_rule_change",
                target_system="gateway",
                idempotency_key="approval:APR-20260316-002",
                status=ExecutionJobStatus.PENDING,
                queued_by="adm_risk_reviewer",
                created_at=now - timedelta(minutes=10),
                updated_at=now - timedelta(minutes=10),
            ),
            "job_apr_3": AdminExecutionJob(
                job_id="job_apr_3",
                approval_id="APR-20260316-003",
                execution_type="deposit_repair",
                target_system="gateway",
                idempotency_key="approval:APR-20260316-003",
                status=ExecutionJobStatus.FAILED,
                queued_by="adm_finance_reviewer",
                error_code="LEDGER_RETRY_REQUIRED",
                error_message="Gateway execution failed and requires retry",
                retry_count=1,
                created_at=now - timedelta(minutes=19),
                updated_at=now - timedelta(minutes=5),
            ),
        }
        attempts = {
            "job_apr_3": [
                AdminExecutionAttempt(
                    job_id="job_apr_3",
                    attempt_no=1,
                    status=ExecutionAttemptStatus.FAILED,
                    error_code="LEDGER_RETRY_REQUIRED",
                    error_summary="Gateway returned retriable execution failure",
                    started_at=now - timedelta(minutes=8),
                    finished_at=now - timedelta(minutes=7),
                )
            ]
        }
        actions = [
            AdminActionAudit(
                action_type="approval.submit",
                result_status=AuditResultStatus.SUCCESS,
                operator_id="adm_finance_admin",
                operator_email="finance@synapse.network",
                operator_role="finance_admin",
                approval_id="APR-20260316-001",
                resource_type="refund_intent",
                resource_id="ref_001",
                created_at=now - timedelta(hours=1),
            ),
            AdminActionAudit(
                action_type="execution.job.failed",
                result_status=AuditResultStatus.FAILURE,
                operator_id="adm_finance_reviewer",
                operator_email="finance-review@synapse.network",
                operator_role="finance_reviewer",
                approval_id="APR-20260316-003",
                job_id="job_apr_3",
                resource_type="deposit_intent",
                resource_id="dep_003",
                error_code="LEDGER_RETRY_REQUIRED",
                created_at=now - timedelta(minutes=5),
            ),
        ]
        return cls(
            identity=InMemoryAdminIdentityRepository(users, factors, challenges, {}),
            authorization=InMemoryAdminAuthorizationRepository(roles, permissions, role_permissions, role_bindings),
            approval=InMemoryAdminApprovalRepository(approvals, steps, {}, jobs, attempts),
            audit=InMemoryAdminAuditRepository(actions, []),
            config=InMemoryAdminConfigRepository(menu_snapshot),
        )
