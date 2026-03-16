"""Admin storage package."""

from src.storage.admin_approval import PostgresAdminApprovalRepository
from src.storage.admin_audit import PostgresAdminAuditRepository
from src.storage.admin_identity import PostgresAdminIdentityRepository
from src.storage.admin_rbac import PostgresAdminAuthorizationRepository
from src.storage.base import (
	AdminApprovalRepository,
	AdminAuditRepository,
	AdminAuthorizationRepository,
	AdminIdentityRepository,
	AdminStore,
)
from src.storage.postgres_store import PostgresAdminStore
from src.storage.in_memory_store import InMemoryAdminStore

__all__ = [
	"AdminApprovalRepository",
	"AdminAuditRepository",
	"AdminAuthorizationRepository",
	"AdminIdentityRepository",
	"AdminStore",
	"InMemoryAdminStore",
	"PostgresAdminApprovalRepository",
	"PostgresAdminAuditRepository",
	"PostgresAdminAuthorizationRepository",
	"PostgresAdminIdentityRepository",
	"PostgresAdminStore",
]
