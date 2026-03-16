from collections.abc import Sequence
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from src.domain import AdminPermission, AdminRole, AdminRolePermission, AdminUserRoleBinding
from src.domain.enums import PermissionRiskLevel, RoleBindingStatus, RoleStatus


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)


def _map_role(row: dict) -> AdminRole:
    return AdminRole(
        role_key=row["role_key"],
        role_name=row["role_name"],
        description=row["description"],
        is_system=row["is_system"],
        status=RoleStatus(row["status"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _map_permission(row: dict) -> AdminPermission:
    return AdminPermission(
        permission_key=row["permission_key"],
        resource_domain=row["resource_domain"],
        action=row["action"],
        risk_level=PermissionRiskLevel(row["risk_level"]),
        description=row["description"],
        created_at=row["created_at"],
    )


def _map_role_permission(row: dict) -> AdminRolePermission:
    return AdminRolePermission(
        role_key=row["role_key"],
        permission_key=row["permission_key"],
        created_at=row["created_at"],
        created_by=row["created_by"],
    )


def _map_role_binding(row: dict) -> AdminUserRoleBinding:
    return AdminUserRoleBinding(
        binding_id=row["binding_id"],
        admin_id=row["admin_id"],
        role_key=row["role_key"],
        scope=row["scope_json"],
        status=RoleBindingStatus(row["status"]),
        granted_by=row["granted_by"],
        grant_reason=row["grant_reason"],
        starts_at=row["starts_at"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class PostgresAdminAuthorizationRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    def list_roles(self) -> Sequence[AdminRole]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_roles ORDER BY role_key ASC")
            rows = cur.fetchall()
        return [_map_role(row) for row in rows]

    def get_role(self, role_key: str) -> AdminRole | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_roles WHERE role_key = %s", (role_key,))
            row = cur.fetchone()
        return _map_role(row) if row else None

    def create_role(self, role: AdminRole) -> AdminRole:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_roles (
                    role_key, role_name, description, is_system, status, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()))
                RETURNING *
                """,
                (
                    role.role_key,
                    role.role_name,
                    role.description,
                    role.is_system,
                    role.status.value,
                    role.created_at,
                    role.updated_at,
                ),
            )
            row = cur.fetchone()
        return _map_role(row)

    def update_role(self, role: AdminRole) -> AdminRole:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_roles
                SET role_name = %s,
                    description = %s,
                    status = %s,
                    updated_at = COALESCE(%s, NOW())
                WHERE role_key = %s
                RETURNING *
                """,
                (
                    role.role_name,
                    role.description,
                    role.status.value,
                    role.updated_at,
                    role.role_key,
                ),
            )
            row = cur.fetchone()
        return _map_role(row)

    def list_permissions(self) -> Sequence[AdminPermission]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_permissions ORDER BY permission_key ASC")
            rows = cur.fetchall()
        return [_map_permission(row) for row in rows]

    def list_role_permissions(self, role_key: str) -> Sequence[AdminRolePermission]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_role_permissions WHERE role_key = %s ORDER BY permission_key ASC",
                (role_key,),
            )
            rows = cur.fetchall()
        return [_map_role_permission(row) for row in rows]

    def replace_role_permissions(self, role_key: str, permissions: Sequence[AdminRolePermission]) -> Sequence[AdminRolePermission]:
        created: list[AdminRolePermission] = []
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM admin_role_permissions WHERE role_key = %s", (role_key,))
            for mapping in permissions:
                cur.execute(
                    """
                    INSERT INTO admin_role_permissions (role_key, permission_key, created_at, created_by)
                    VALUES (%s, %s, COALESCE(%s, NOW()), %s)
                    RETURNING *
                    """,
                    (mapping.role_key, mapping.permission_key, mapping.created_at, mapping.created_by),
                )
                row = cur.fetchone()
                created.append(_map_role_permission(row))
        return created

    def list_role_bindings(self, admin_id: str) -> Sequence[AdminUserRoleBinding]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_user_role_bindings WHERE admin_id = %s ORDER BY created_at ASC",
                (admin_id,),
            )
            rows = cur.fetchall()
        return [_map_role_binding(row) for row in rows]

    def create_role_binding(self, binding: AdminUserRoleBinding) -> AdminUserRoleBinding:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_user_role_bindings (
                    binding_id, admin_id, role_key, scope_json, status,
                    granted_by, grant_reason, starts_at, expires_at, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()))
                RETURNING *
                """,
                (
                    binding.binding_id,
                    binding.admin_id,
                    binding.role_key,
                    Jsonb(binding.scope),
                    binding.status.value,
                    binding.granted_by,
                    binding.grant_reason,
                    binding.starts_at,
                    binding.expires_at,
                    binding.created_at,
                    binding.updated_at,
                ),
            )
            row = cur.fetchone()
        return _map_role_binding(row)

    def replace_role_bindings(
        self,
        admin_id: str,
        bindings: Sequence[AdminUserRoleBinding],
    ) -> Sequence[AdminUserRoleBinding]:
        now = datetime.now(timezone.utc)
        created: list[AdminUserRoleBinding] = []
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_user_role_bindings
                SET status = 'revoked', updated_at = %s
                WHERE admin_id = %s AND status = 'active'
                """,
                (now, admin_id),
            )
            for binding in bindings:
                cur.execute(
                    """
                    INSERT INTO admin_user_role_bindings (
                        binding_id, admin_id, role_key, scope_json, status,
                        granted_by, grant_reason, starts_at, expires_at, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()))
                    RETURNING *
                    """,
                    (
                        binding.binding_id,
                        binding.admin_id,
                        binding.role_key,
                        Jsonb(binding.scope),
                        binding.status.value,
                        binding.granted_by,
                        binding.grant_reason,
                        binding.starts_at,
                        binding.expires_at,
                        binding.created_at,
                        binding.updated_at,
                    ),
                )
                row = cur.fetchone()
                created.append(_map_role_binding(row))
        return created