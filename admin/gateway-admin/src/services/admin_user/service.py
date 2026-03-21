from dataclasses import replace
from datetime import datetime, timezone
from uuid import uuid4

from src.core.errors import AuthorizationError, BadRequestError, ResourceNotFoundError
from src.core.security import hash_password
from src.domain import AdminActionAudit, AdminRole, AdminRolePermission, AdminUser, AdminUserRoleBinding
from src.domain.enums import AdminUserStatus, AuditResultStatus, AuthSource, RoleBindingStatus, RoleStatus
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore


USER_READ_ROLES = {"super_admin", "platform_ops_admin"}
USER_WRITE_ROLES = {"super_admin"}
ROLE_WRITE_ROLES = {"super_admin"}


def _serialize_timestamp(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


class AdminUserService:
    def __init__(self, store: AdminStore) -> None:
        self._store = store

    def list_users(
        self,
        operator: AdminIdentity,
        status: str | None = None,
        limit: int = 100,
        search: str | None = None,
        role_key: str | None = None,
    ) -> dict:
        self._ensure_role(operator, USER_READ_ROLES)
        users = self._store.identity.list_users(status=status, limit=limit)
        items = [self._serialize_user(user) for user in users]
        normalized_search = search.strip().lower() if search else None
        if normalized_search:
            items = [
                item
                for item in items
                if normalized_search in item["email"].lower() or normalized_search in item["displayName"].lower()
            ]
        if role_key:
            items = [item for item in items if role_key in item["roleKeys"]]
        return {
            "items": items[:limit],
            "nextCursor": None,
        }

    def list_roles(self, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, USER_READ_ROLES)
        items = []
        for role in self._store.authorization.list_roles():
            items.append(self._serialize_role(role))
        return {"items": items}

    def list_permissions(self, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, USER_READ_ROLES)
        return {
            "items": [
                {
                    "permissionKey": permission.permission_key,
                    "resourceDomain": permission.resource_domain,
                    "action": permission.action,
                    "riskLevel": permission.risk_level.value,
                    "description": permission.description,
                }
                for permission in self._store.authorization.list_permissions()
            ]
        }

    def create_role(self, payload: dict, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, ROLE_WRITE_ROLES)
        role_key = payload["roleKey"].strip()
        if self._store.authorization.get_role(role_key) is not None:
            raise BadRequestError("Role key already exists")

        now = datetime.now(timezone.utc)
        role = self._store.authorization.create_role(
            AdminRole(
                role_key=role_key,
                role_name=payload["roleName"].strip(),
                description=payload.get("description"),
                is_system=False,
                status=self._parse_role_status(payload.get("status", "active")),
                created_at=now,
                updated_at=now,
            )
        )
        self._replace_role_permissions(role.role_key, payload.get("permissions", []), operator, now)
        serialized_role = self._serialize_role(role)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin_role.create",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="admin_role",
                resource_id=role.role_key,
                after=serialized_role,
                created_at=now,
            )
        )
        return {"role": serialized_role}

    def update_role(self, role_key: str, payload: dict, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, ROLE_WRITE_ROLES)
        current_role = self._store.authorization.get_role(role_key)
        if current_role is None:
            raise ResourceNotFoundError("Admin role does not exist")

        now = datetime.now(timezone.utc)
        updated_role = self._store.authorization.update_role(
            replace(
                current_role,
                role_name=payload["roleName"].strip(),
                description=payload.get("description"),
                status=self._parse_role_status(payload["status"]),
                updated_at=now,
            )
        )
        self._replace_role_permissions(role_key, payload.get("permissions", []), operator, now)
        serialized_role = self._serialize_role(updated_role)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin_role.update",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="admin_role",
                resource_id=role_key,
                before=self._serialize_role(current_role),
                after=serialized_role,
                created_at=now,
            )
        )
        return {"role": serialized_role}

    def disable_role(self, role_key: str, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, ROLE_WRITE_ROLES)
        current_role = self._store.authorization.get_role(role_key)
        if current_role is None:
            raise ResourceNotFoundError("Admin role does not exist")

        now = datetime.now(timezone.utc)
        disabled_role = self._store.authorization.update_role(
            replace(current_role, status=RoleStatus.DISABLED, updated_at=now)
        )
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin_role.disable",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="admin_role",
                resource_id=role_key,
                before={"status": current_role.status.value},
                after={"status": disabled_role.status.value},
                created_at=now,
            )
        )
        return {"roleKey": role_key, "status": disabled_role.status.value}

    def create_user(self, payload: dict, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, USER_WRITE_ROLES)

        normalized_email = payload["email"].strip().lower()
        if self._store.identity.get_user_by_email(normalized_email) is not None:
            raise BadRequestError("Admin email already exists")

        role = next((item for item in self._store.authorization.list_roles() if item.role_key == payload["roleKey"]), None)
        if role is None or role.status != RoleStatus.ACTIVE:
            raise BadRequestError("Selected role is not available")

        try:
            user_status = AdminUserStatus(payload.get("status", "active"))
        except ValueError as exc:
            raise BadRequestError("Invalid admin status") from exc

        now = datetime.now(timezone.utc)
        user = self._store.identity.create_user(
            AdminUser(
                admin_id=f"adm_{uuid4().hex[:16]}",
                email=normalized_email,
                display_name=payload["displayName"].strip(),
                status=user_status,
                auth_source=AuthSource.BOOTSTRAP,
                password_hash=hash_password(payload["password"]),
                require_mfa=payload.get("requireMfa", False),
                created_at=now,
                updated_at=now,
            )
        )
        self._store.authorization.create_role_binding(
            AdminUserRoleBinding(
                binding_id=f"bind_{uuid4().hex[:16]}",
                admin_id=user.admin_id,
                role_key=role.role_key,
                scope={},
                status=RoleBindingStatus.ACTIVE,
                granted_by=operator.admin_id,
                grant_reason="admin console user creation",
                starts_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        serialized_user = self._serialize_user(user)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin_user.create",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="admin_user",
                resource_id=user.admin_id,
                after={
                    "email": user.email,
                    "roleKeys": serialized_user["roleKeys"],
                    "requireMfa": user.require_mfa,
                    "status": user.status.value,
                },
                created_at=now,
            )
        )
        return {"admin": serialized_user}

    def update_user(self, admin_id: str, payload: dict, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, USER_WRITE_ROLES)

        current_user = self._store.identity.get_user_by_id(admin_id)
        if current_user is None:
            raise ResourceNotFoundError("Admin user does not exist")

        role = self._resolve_role(payload["roleKey"])
        next_status = self._parse_status(payload["status"])
        now = datetime.now(timezone.utc)
        password_hash = current_user.password_hash
        if payload.get("password"):
            password_hash = hash_password(payload["password"])

        updated_user = self._store.identity.update_user(
            replace(
                current_user,
                display_name=payload["displayName"].strip(),
                status=next_status,
                password_hash=password_hash,
                require_mfa=payload["requireMfa"],
                updated_at=now,
                disabled_at=now if next_status == AdminUserStatus.DISABLED else None,
            )
        )
        self._replace_role_bindings(admin_id=admin_id, role_key=role.role_key, operator=operator, now=now, reason="admin console user update")
        serialized_user = self._serialize_user(updated_user)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin_user.update",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="admin_user",
                resource_id=updated_user.admin_id,
                before={
                    "displayName": current_user.display_name,
                    "status": current_user.status.value,
                    "requireMfa": current_user.require_mfa,
                    "roleKeys": self._serialize_user(current_user)["roleKeys"],
                },
                after={
                    "displayName": updated_user.display_name,
                    "status": updated_user.status.value,
                    "requireMfa": updated_user.require_mfa,
                    "roleKeys": serialized_user["roleKeys"],
                },
                created_at=now,
            )
        )
        return {"admin": serialized_user}

    def disable_user(self, admin_id: str, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, USER_WRITE_ROLES)
        if admin_id == operator.admin_id:
            raise BadRequestError("Current operator cannot disable the active session owner")

        current_user = self._store.identity.get_user_by_id(admin_id)
        if current_user is None:
            raise ResourceNotFoundError("Admin user does not exist")

        now = datetime.now(timezone.utc)
        disabled_user = self._store.identity.update_user(
            replace(
                current_user,
                status=AdminUserStatus.DISABLED,
                updated_at=now,
                disabled_at=now,
            )
        )
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="admin_user.disable",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="admin_user",
                resource_id=disabled_user.admin_id,
                before={"status": current_user.status.value},
                after={"status": disabled_user.status.value},
                created_at=now,
            )
        )
        return {"adminId": disabled_user.admin_id, "status": disabled_user.status.value}

    def _serialize_user(self, user: AdminUser) -> dict:
        role_bindings = self._active_role_bindings(user.admin_id)
        role_keys = [binding.role_key for binding in role_bindings]
        permissions = sorted(
            {
                mapping.permission_key
                for role_key in role_keys
                for mapping in self._store.authorization.list_role_permissions(role_key)
            }
        )
        return {
            "adminId": user.admin_id,
            "email": user.email,
            "displayName": user.display_name,
            "status": user.status.value,
            "authSource": user.auth_source.value,
            "requireMfa": user.require_mfa,
            "lastLoginAt": _serialize_timestamp(user.last_login_at),
            "createdAt": _serialize_timestamp(user.created_at),
            "updatedAt": _serialize_timestamp(user.updated_at),
            "roleKeys": role_keys,
            "permissions": permissions,
        }

    def _serialize_role(self, role: AdminRole) -> dict:
        return {
            "roleKey": role.role_key,
            "roleName": role.role_name,
            "description": role.description,
            "status": role.status.value,
            "permissions": [mapping.permission_key for mapping in self._store.authorization.list_role_permissions(role.role_key)],
        }

    def _active_role_bindings(self, admin_id: str) -> list[AdminUserRoleBinding]:
        return [
            binding
            for binding in self._store.authorization.list_role_bindings(admin_id)
            if binding.status == RoleBindingStatus.ACTIVE
        ]

    def _resolve_role(self, role_key: str):
        role = next((item for item in self._store.authorization.list_roles() if item.role_key == role_key), None)
        if role is None or role.status != RoleStatus.ACTIVE:
            raise BadRequestError("Selected role is not available")
        return role

    def _parse_role_status(self, raw_status: str) -> RoleStatus:
        try:
            return RoleStatus(raw_status)
        except ValueError as exc:
            raise BadRequestError("Invalid role status") from exc

    def _replace_role_permissions(self, role_key: str, permission_keys: list[str], operator: AdminIdentity, now: datetime) -> None:
        available_permission_keys = {permission.permission_key for permission in self._store.authorization.list_permissions()}
        invalid_permissions = [permission_key for permission_key in permission_keys if permission_key not in available_permission_keys]
        if invalid_permissions:
            raise BadRequestError("Invalid role permissions")
        self._store.authorization.replace_role_permissions(
            role_key,
            [
                AdminRolePermission(
                    role_key=role_key,
                    permission_key=permission_key,
                    created_at=now,
                    created_by=operator.admin_id,
                )
                for permission_key in permission_keys
            ],
        )

    def _parse_status(self, raw_status: str) -> AdminUserStatus:
        try:
            return AdminUserStatus(raw_status)
        except ValueError as exc:
            raise BadRequestError("Invalid admin status") from exc

    def _replace_role_bindings(self, admin_id: str, role_key: str, operator: AdminIdentity, now: datetime, reason: str) -> None:
        self._store.authorization.replace_role_bindings(
            admin_id,
            [
                AdminUserRoleBinding(
                    binding_id=f"bind_{uuid4().hex[:16]}",
                    admin_id=admin_id,
                    role_key=role_key,
                    scope={},
                    status=RoleBindingStatus.ACTIVE,
                    granted_by=operator.admin_id,
                    grant_reason=reason,
                    starts_at=now,
                    created_at=now,
                    updated_at=now,
                )
            ],
        )

    @staticmethod
    def _ensure_role(operator: AdminIdentity, allowed_roles: set[str]) -> None:
        if operator.role not in allowed_roles:
            raise AuthorizationError("Admin role is not allowed to manage admin users")