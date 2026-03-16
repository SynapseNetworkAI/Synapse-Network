from collections.abc import Sequence

from src.domain import AdminMfaFactor, AdminSession, AdminUser
from src.domain.enums import AdminSessionStatus, AdminUserStatus, AuthSource, MfaFactorStatus, MfaFactorType


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)


def _map_user(row: dict) -> AdminUser:
    return AdminUser(
        admin_id=row["admin_id"],
        email=row["email"],
        display_name=row["display_name"],
        status=AdminUserStatus(row["status"]),
        auth_source=AuthSource(row["auth_source"]),
        sso_subject=row["sso_subject"],
        password_hash=row["password_hash"],
        require_mfa=row["require_mfa"],
        last_login_at=row["last_login_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        disabled_at=row["disabled_at"],
    )


def _map_factor(row: dict) -> AdminMfaFactor:
    return AdminMfaFactor(
        factor_id=row["factor_id"],
        admin_id=row["admin_id"],
        factor_type=MfaFactorType(row["factor_type"]),
        factor_label=row["factor_label"],
        status=MfaFactorStatus(row["status"]),
        secret_ref=row["secret_ref"],
        payload=row["payload_json"],
        last_verified_at=row["last_verified_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        revoked_at=row["revoked_at"],
    )


def _map_session(row: dict) -> AdminSession:
    return AdminSession(
        session_id=row["session_id"],
        admin_id=row["admin_id"],
        token_jti=row["token_jti"],
        expires_at=row["expires_at"],
        refresh_token_hash=row["refresh_token_hash"],
        status=AdminSessionStatus(row["status"]),
        mfa_verified_at=row["mfa_verified_at"],
        client_ip=row["client_ip"],
        user_agent=row["user_agent"],
        issued_at=row["issued_at"],
        last_seen_at=row["last_seen_at"],
        revoked_at=row["revoked_at"],
        created_at=row["created_at"],
    )


class PostgresAdminIdentityRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    def get_user_by_id(self, admin_id: str) -> AdminUser | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_users WHERE admin_id = %s", (admin_id,))
            row = cur.fetchone()
        return _map_user(row) if row else None

    def get_user_by_email(self, email: str) -> AdminUser | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_users WHERE lower(email) = lower(%s)", (email,))
            row = cur.fetchone()
        return _map_user(row) if row else None

    def list_mfa_factors(self, admin_id: str) -> Sequence[AdminMfaFactor]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_mfa_factors WHERE admin_id = %s ORDER BY created_at ASC",
                (admin_id,),
            )
            rows = cur.fetchall()
        return [_map_factor(row) for row in rows]

    def get_session_by_id(self, session_id: str) -> AdminSession | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_sessions WHERE session_id = %s", (session_id,))
            row = cur.fetchone()
        return _map_session(row) if row else None

    def create_session(self, session: AdminSession) -> AdminSession:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_sessions (
                    session_id, admin_id, token_jti, refresh_token_hash, status,
                    mfa_verified_at, client_ip, user_agent, issued_at, last_seen_at,
                    expires_at, revoked_at, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()))
                """,
                (
                    session.session_id,
                    session.admin_id,
                    session.token_jti,
                    session.refresh_token_hash,
                    session.status.value,
                    session.mfa_verified_at,
                    session.client_ip,
                    session.user_agent,
                    session.issued_at,
                    session.last_seen_at,
                    session.expires_at,
                    session.revoked_at,
                    session.created_at,
                ),
            )
        return session

    def revoke_session(self, session_id: str) -> None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE admin_sessions SET status = 'revoked', revoked_at = NOW() WHERE session_id = %s",
                (session_id,),
            )

    def touch_last_login(self, admin_id: str) -> None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE admin_users SET last_login_at = NOW(), updated_at = NOW() WHERE admin_id = %s",
                (admin_id,),
            )