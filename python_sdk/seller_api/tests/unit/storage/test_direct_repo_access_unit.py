# pyright: reportMissingImports=false

from src.storage.postgres import direct_repo_access


def test_direct_fee_policy_repo_reads_from_facade(temp_storage):
    repo = direct_repo_access.direct_fee_policy_repo(temp_storage)
    assert repo is temp_storage.get_data_manager().finance.fee_policy


def test_direct_gateway_state_repo_reads_from_facade(temp_storage):
    repo = direct_repo_access.direct_gateway_state_repo(temp_storage)
    assert repo is temp_storage.get_data_manager().system.gateway_state


def test_direct_repo_access_uses_storage_data_manager(temp_storage):
    fee_repo = direct_repo_access.direct_fee_policy_repo(temp_storage)
    gateway_repo = direct_repo_access.direct_gateway_state_repo(temp_storage)

    assert fee_repo is temp_storage.get_data_manager().finance.fee_policy
    assert gateway_repo is temp_storage.get_data_manager().system.gateway_state
