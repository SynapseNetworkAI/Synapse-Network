# pyright: reportMissingImports=false

from src.storage.repository_provider import (
    audit_repo,
    balance_repo,
    credential_auth_repo,
    fee_policy_repo,
    gateway_state_repo,
    idempotency_repo,
    service_registry_repo,
)


def test_inmemory_storage_exposes_typed_repository_provider(temp_storage):
    provider = temp_storage.get_repository_provider()

    assert provider.gateway_state is temp_storage
    assert provider.balance is temp_storage
    assert provider.audit is temp_storage
    assert provider.service_registry is temp_storage
    assert provider.credential_auth is temp_storage
    assert provider.fee_policy is temp_storage
    assert provider.idempotency is temp_storage


def test_repository_helper_accessors_resolve_from_storage_provider(temp_storage):
    assert gateway_state_repo(temp_storage) is temp_storage
    assert balance_repo(temp_storage) is temp_storage
    assert audit_repo(temp_storage) is temp_storage
    assert service_registry_repo(temp_storage) is temp_storage
    assert credential_auth_repo(temp_storage) is temp_storage
    assert fee_policy_repo(temp_storage) is temp_storage
    assert idempotency_repo(temp_storage) is temp_storage
