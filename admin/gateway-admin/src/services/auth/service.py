from dataclasses import dataclass

from src.core.config import get_settings
from src.core.errors import AuthenticationError, BadRequestError

DASHBOARD_READ = "dashboard:read"
APPROVAL_READ = "approval:read"
APPROVAL_SUBMIT = "approval:submit"
APPROVAL_DECIDE = "approval:decide"


@dataclass(frozen=True)
class AdminIdentity:
    admin_id: str
    email: str
    display_name: str
    role: str
    permissions: tuple[str, ...]


class AdminAuthService:
    def __init__(self) -> None:
        self._settings = get_settings()

    def login(self, email: str, otp_code: str) -> tuple[str, AdminIdentity]:
        if not email.strip() or not otp_code.strip():
            raise BadRequestError("email and otpCode are required")
        role = self._resolve_role(email)
        admin = self._build_identity(email=email, role=role)
        token = f"{self._settings.token_prefix}{role}"
        return token, admin

    def get_current_admin(self, token: str) -> AdminIdentity:
        if not token.startswith(self._settings.token_prefix):
            raise AuthenticationError("Invalid admin token")
        role = token.removeprefix(self._settings.token_prefix).strip()
        if not role:
            raise AuthenticationError("Invalid admin token")
        email = f"{role}@synapse.local"
        return self._build_identity(email=email, role=role)

    def _resolve_role(self, email: str) -> str:
        normalized = email.strip().lower()
        if normalized.startswith("super"):
            return "super_admin"
        if normalized.startswith("finance-review"):
            return "finance_reviewer"
        if normalized.startswith("finance") or normalized.startswith("ops"):
            return "finance_admin"
        if normalized.startswith("risk-review"):
            return "risk_reviewer"
        if normalized.startswith("risk"):
            return "risk_admin"
        if normalized.startswith("audit"):
            return "compliance_auditor"
        if normalized.startswith("readonly"):
            return "readonly_analyst"
        return "platform_ops_admin"

    def _build_identity(self, email: str, role: str) -> AdminIdentity:
        permissions_by_role = {
            "super_admin": (
                DASHBOARD_READ,
                APPROVAL_READ,
                APPROVAL_SUBMIT,
                APPROVAL_DECIDE,
            ),
            "finance_admin": (DASHBOARD_READ, APPROVAL_SUBMIT, APPROVAL_READ),
            "finance_reviewer": (DASHBOARD_READ, APPROVAL_READ, APPROVAL_DECIDE),
            "risk_admin": (DASHBOARD_READ, APPROVAL_SUBMIT, APPROVAL_READ),
            "risk_reviewer": (DASHBOARD_READ, APPROVAL_READ, APPROVAL_DECIDE),
            "compliance_auditor": (DASHBOARD_READ, APPROVAL_READ, "audit:read"),
            "platform_ops_admin": (DASHBOARD_READ, APPROVAL_READ),
            "readonly_analyst": (DASHBOARD_READ,),
        }
        permissions = permissions_by_role.get(role, (DASHBOARD_READ,))
        return AdminIdentity(
            admin_id=f"adm_{role}",
            email=email,
            display_name=role.replace("_", " ").title(),
            role=role,
            permissions=permissions,
        )
