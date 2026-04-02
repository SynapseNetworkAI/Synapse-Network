from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.domain.enums import PermissionRiskLevel, RoleBindingStatus, RoleStatus


@dataclass(slots=True, frozen=True)
class AdminRole:
    role_key: str
    role_name: str
    description: str | None = None
    is_system: bool = True
    status: RoleStatus = RoleStatus.ACTIVE
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminPermission:
    permission_key: str
    resource_domain: str
    action: str
    risk_level: PermissionRiskLevel = PermissionRiskLevel.LOW
    description: str | None = None
    created_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminRolePermission:
    role_key: str
    permission_key: str
    created_at: datetime | None = None
    created_by: str | None = None


@dataclass(slots=True, frozen=True)
class AdminUserRoleBinding:
    binding_id: str
    admin_id: str
    role_key: str
    scope: dict[str, Any] = field(default_factory=dict)
    status: RoleBindingStatus = RoleBindingStatus.ACTIVE
    granted_by: str | None = None
    grant_reason: str | None = None
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None