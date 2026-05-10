from collections.abc import Sequence
from datetime import datetime

import psycopg
from psycopg import errors as psycopg_errors
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.core.errors import DuplicateGoogleAuthenticatorSecretError
from src.domain import AdminMfaEnrollmentChallenge, AdminMfaFactor, AdminSession, AdminUser
from src.domain.enums import AdminSessionStatus, AdminUserStatus, AuthSource, MfaEnrollmentChallengeStatus, MfaFactorStatus, MfaFactorType


def _connect(dsn: str):
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
        failed_login_attempts=row.get("failed_login_attempts", 0) or 0,
        last_failed_login_at=row.get("last_failed_login_at"),
        locked_until=row.get("locked_until"),
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
        totp_secret_fingerprint=row.get("totp_secret_fingerprint"),
        payload=row["payload_json"],
        last_verified_at=row["last_verified_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        revoked_at=row["revoked_at"],
    )


def _map_enrollment_challenge(row: dict) -> AdminMfaEnrollmentChallenge:
    return AdminMfaEnrollmentChallenge(
        challenge_id=row["challenge_id"],
        admin_id=row["admin_id"],
        challenge_token_hash=row["challenge_token_hash"],
        status=MfaEnrollmentChallengeStatus(row["status"]),
        factor_id=row["factor_id"],
        client_ip=row["client_ip"],
        user_agent=row["user_agent"],
        request_id=row["request_id"],
        expires_at=row["expires_at"],
        issued_at=row["issued_at"],
        verified_at=row["verified_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
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


def _mfa_factor_upsert_sql() -> str:
    return """
        INSERT INTO admin_mfa_factors (
            factor_id, admin_id, factor_type, factor_label, status,
            secret_ref, totp_secret_fingerprint, payload_json, last_verified_at, created_at, updated_at, revoked_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()), %s)
        ON CONFLICT (factor_id)
        DO UPDATE SET admin_id = EXCLUDED.admin_id,
                      factor_type = EXCLUDED.factor_type,
                      factor_label = EXCLUDED.factor_label,
                      status = EXCLUDED.status,
                      secret_ref = EXCLUDED.secret_ref,
                      totp_secret_fingerprint = EXCLUDED.totp_secret_fingerprint,
                      payload_json = EXCLUDED.payload_json,
                      last_verified_at = EXCLUDED.last_verified_at,
                      updated_at = EXCLUDED.updated_at,
                      revoked_at = EXCLUDED.revoked_at
        RETURNING *
    """


def _mfa_factor_upsert_params(factor: AdminMfaFactor) -> tuple[object, ...]:
    return (
        factor.factor_id,
        factor.admin_id,
        factor.factor_type.value,
        factor.factor_label,
        factor.status.value,
        factor.secret_ref,
        factor.totp_secret_fingerprint,
        Jsonb(factor.payload),
        factor.last_verified_at,
        factor.created_at,
        factor.updated_at,
        factor.revoked_at,
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

    def list_users(self, status: str | None = None, limit: int = 100) -> Sequence[AdminUser]:
        query = "SELECT * FROM admin_users"
        params: list[object] = []
        if status:
            query += " WHERE status = %s"
            params.append(status)
        query += " ORDER BY updated_at DESC, created_at DESC LIMIT %s"
        params.append(limit)
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
        return [_map_user(row) for row in rows]

    def create_user(self, user: AdminUser) -> AdminUser:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_users (
                    admin_id, email, display_name, status, auth_source, sso_subject,
                    password_hash, require_mfa, last_login_at, failed_login_attempts,
                    last_failed_login_at, locked_until, created_at, updated_at, disabled_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()), %s)
                RETURNING *
                """,
                (
                    user.admin_id,
                    user.email,
                    user.display_name,
                    user.status.value,
                    user.auth_source.value,
                    user.sso_subject,
                    user.password_hash,
                    user.require_mfa,
                    user.last_login_at,
                    user.failed_login_attempts,
                    user.last_failed_login_at,
                    user.locked_until,
                    user.created_at,
                    user.updated_at,
                    user.disabled_at,
                ),
            )
            row = cur.fetchone()
        return _map_user(row)

    def update_user(self, user: AdminUser) -> AdminUser:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_users
                SET display_name = %s,
                    status = %s,
                    password_hash = %s,
                    require_mfa = %s,
                    failed_login_attempts = %s,
                    last_failed_login_at = %s,
                    locked_until = %s,
                    updated_at = COALESCE(%s, NOW()),
                    disabled_at = %s
                WHERE admin_id = %s
                RETURNING *
                """,
                (
                    user.display_name,
                    user.status.value,
                    user.password_hash,
                    user.require_mfa,
                    user.failed_login_attempts,
                    user.last_failed_login_at,
                    user.locked_until,
                    user.updated_at,
                    user.disabled_at,
                    user.admin_id,
                ),
            )
            row = cur.fetchone()
        return _map_user(row)

    def update_password_hash(self, admin_id: str, password_hash: str) -> None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE admin_users SET password_hash = %s, updated_at = NOW() WHERE admin_id = %s",
                (password_hash, admin_id),
            )

    def list_mfa_factors(self, admin_id: str) -> Sequence[AdminMfaFactor]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_mfa_factors WHERE admin_id = %s ORDER BY created_at ASC",
                (admin_id,),
            )
            rows = cur.fetchall()
        return [_map_factor(row) for row in rows]

    def get_mfa_factor_by_id(self, factor_id: str) -> AdminMfaFactor | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_mfa_factors WHERE factor_id = %s", (factor_id,))
            row = cur.fetchone()
        return _map_factor(row) if row else None

    def get_mfa_factor_by_identity(self, admin_id: str, factor_type: str, factor_label: str) -> AdminMfaFactor | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM admin_mfa_factors
                WHERE admin_id = %s AND factor_type = %s AND factor_label = %s
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (admin_id, factor_type, factor_label),
            )
            row = cur.fetchone()
        return _map_factor(row) if row else None

    def upsert_mfa_factor(self, factor: AdminMfaFactor) -> AdminMfaFactor:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            try:
                cur.execute(_mfa_factor_upsert_sql(), _mfa_factor_upsert_params(factor))
                row = cur.fetchone()
            except psycopg_errors.UniqueViolation:
                conn.rollback()
                with conn.cursor() as retry_cur:
                    retry_cur.execute(
                        """
                        UPDATE admin_mfa_factors
                        SET status = %s,
                            secret_ref = %s,
                            totp_secret_fingerprint = %s,
                            payload_json = %s::jsonb,
                            last_verified_at = %s,
                            updated_at = COALESCE(%s, NOW()),
                            revoked_at = %s
                        WHERE admin_id = %s AND factor_type = %s AND factor_label = %s
                        RETURNING *
                        """,
                        (
                            factor.status.value,
                            factor.secret_ref,
                            factor.totp_secret_fingerprint,
                            Jsonb(factor.payload),
                            factor.last_verified_at,
                            factor.updated_at,
                            factor.revoked_at,
                            factor.admin_id,
                            factor.factor_type.value,
                            factor.factor_label,
                        ),
                    )
                    row = retry_cur.fetchone()
                    if row is None:
                        raise DuplicateGoogleAuthenticatorSecretError() from None
        return _map_factor(row)

    def list_mfa_enrollment_challenges(self, admin_id: str) -> Sequence[AdminMfaEnrollmentChallenge]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM admin_mfa_enrollment_challenges
                WHERE admin_id = %s
                ORDER BY created_at DESC
                """,
                (admin_id,),
            )
            rows = cur.fetchall()
        return [_map_enrollment_challenge(row) for row in rows]

    def get_mfa_enrollment_challenge_by_token_hash(self, token_hash: str) -> AdminMfaEnrollmentChallenge | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_mfa_enrollment_challenges WHERE challenge_token_hash = %s",
                (token_hash,),
            )
            row = cur.fetchone()
        return _map_enrollment_challenge(row) if row else None

    def upsert_mfa_enrollment_challenge(self, challenge: AdminMfaEnrollmentChallenge) -> AdminMfaEnrollmentChallenge:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_mfa_enrollment_challenges (
                    challenge_id, admin_id, challenge_token_hash, status, factor_id,
                    client_ip, user_agent, request_id, expires_at, issued_at,
                    verified_at, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW()))
                ON CONFLICT (challenge_id)
                DO UPDATE SET admin_id = EXCLUDED.admin_id,
                              challenge_token_hash = EXCLUDED.challenge_token_hash,
                              status = EXCLUDED.status,
                              factor_id = EXCLUDED.factor_id,
                              client_ip = EXCLUDED.client_ip,
                              user_agent = EXCLUDED.user_agent,
                              request_id = EXCLUDED.request_id,
                              expires_at = EXCLUDED.expires_at,
                              issued_at = EXCLUDED.issued_at,
                              verified_at = EXCLUDED.verified_at,
                              updated_at = EXCLUDED.updated_at
                RETURNING *
                """,
                (
                    challenge.challenge_id,
                    challenge.admin_id,
                    challenge.challenge_token_hash,
                    challenge.status.value,
                    challenge.factor_id,
                    challenge.client_ip,
                    challenge.user_agent,
                    challenge.request_id,
                    challenge.expires_at,
                    challenge.issued_at,
                    challenge.verified_at,
                    challenge.created_at,
                    challenge.updated_at,
                ),
            )
            row = cur.fetchone()
        return _map_enrollment_challenge(row)

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

    def record_login_failure(self, admin_id: str, failed_at: datetime) -> AdminUser | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_users
                SET failed_login_attempts = failed_login_attempts + 1,
                    last_failed_login_at = %s,
                    updated_at = NOW()
                WHERE admin_id = %s
                RETURNING *
                """,
                (failed_at, admin_id),
            )
            row = cur.fetchone()
        return _map_user(row) if row else None

    def clear_login_failures(self, admin_id: str) -> AdminUser | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_users
                SET failed_login_attempts = 0,
                    last_failed_login_at = NULL,
                    locked_until = NULL,
                    updated_at = NOW()
                WHERE admin_id = %s
                RETURNING *
                """,
                (admin_id,),
            )
            row = cur.fetchone()
        return _map_user(row) if row else None

    def lock_user_until(self, admin_id: str, locked_until: datetime) -> AdminUser | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_users
                SET locked_until = %s,
                    updated_at = NOW()
                WHERE admin_id = %s
                RETURNING *
                """,
                (locked_until, admin_id),
            )
            row = cur.fetchone()
        return _map_user(row) if row else None
