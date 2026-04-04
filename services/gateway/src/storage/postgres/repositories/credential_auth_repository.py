"""Credential auth repository — thin composer class."""
from __future__ import annotations

from typing import Any, Callable

from ..database_manager import DatabaseManager
from .credential_auth_core_mixin import CredentialAuthCoreMixin
from .credential_auth_query_mixin import CredentialAuthQueryMixin


class CredentialAuthRepository(CredentialAuthCoreMixin, CredentialAuthQueryMixin):
    """Postgres-backed credential auth repository."""

    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6
