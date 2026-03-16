from collections.abc import Sequence

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

    def list_role_bindings(self, admin_id: str) -> Sequence[AdminUserRoleBinding]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_user_role_bindings WHERE admin_id = %s ORDER BY created_at ASC",
                (admin_id,),
            )
            rows = cur.fetchall()
        return [_map_role_binding(row) for row in rows]