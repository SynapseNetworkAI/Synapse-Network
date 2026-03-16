from dataclasses import dataclass

from src.storage.admin_config import PostgresAdminConfigRepository
from src.storage.admin_approval import PostgresAdminApprovalRepository
from src.storage.admin_audit import PostgresAdminAuditRepository
from src.storage.admin_identity import PostgresAdminIdentityRepository
from src.storage.admin_rbac import PostgresAdminAuthorizationRepository


@dataclass(slots=True)
class PostgresAdminStore:
    identity: PostgresAdminIdentityRepository
    authorization: PostgresAdminAuthorizationRepository
    approval: PostgresAdminApprovalRepository
    audit: PostgresAdminAuditRepository
    config: PostgresAdminConfigRepository

    @classmethod
    def from_dsn(cls, dsn: str) -> "PostgresAdminStore":
        return cls(
            identity=PostgresAdminIdentityRepository(dsn),
            authorization=PostgresAdminAuthorizationRepository(dsn),
            approval=PostgresAdminApprovalRepository(dsn),
            audit=PostgresAdminAuditRepository(dsn),
            config=PostgresAdminConfigRepository(dsn),
        )