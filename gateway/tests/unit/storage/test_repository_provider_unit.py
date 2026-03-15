# pyright: reportMissingImports=false

def test_inmemory_storage_exposes_synapse_data_manager(temp_storage):
    db = temp_storage.get_data_manager()

    assert db.finance.balance is temp_storage
    assert db.finance.atomic is temp_storage
    assert db.finance.fee_policy is temp_storage
    assert db.system.gateway_state is temp_storage
    assert db.system.idempotency is temp_storage
    assert db.system.registry is temp_storage
    assert db.system.credential_auth is temp_storage
    assert db.audit.logs is temp_storage
