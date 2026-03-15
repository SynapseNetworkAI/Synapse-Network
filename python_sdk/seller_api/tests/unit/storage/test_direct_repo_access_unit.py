# pyright: reportMissingImports=false

from src.storage.postgres import direct_repo_access


def test_direct_fee_policy_repo_falls_back_for_non_postgres(temp_storage):
    repo = direct_repo_access.direct_fee_policy_repo(temp_storage)
    assert repo is temp_storage.get_repository_provider().fee_policy


def test_direct_gateway_state_repo_falls_back_for_non_postgres(temp_storage):
    repo = direct_repo_access.direct_gateway_state_repo(temp_storage)
    assert repo is temp_storage.get_repository_provider().gateway_state


def test_direct_repo_access_uses_concrete_repositories_for_postgres(monkeypatch):
    captured = {}

    class FakePostgresStorage:
        def get_database_manager(self):
            return "fake-db-manager"

    class FakeFeeRepo:
        def __init__(self, db, q6):
            captured["fee_db"] = db
            captured["fee_q6"] = q6

    class FakeGatewayRepo:
        def __init__(self, db, q6):
            captured["gateway_db"] = db
            captured["gateway_q6"] = q6

    monkeypatch.setattr(direct_repo_access, "PostgresStorage", FakePostgresStorage)
    monkeypatch.setattr(direct_repo_access, "FeePolicyRepository", FakeFeeRepo)
    monkeypatch.setattr(direct_repo_access, "GatewayStateRepository", FakeGatewayRepo)

    storage = FakePostgresStorage()
    fee_repo = direct_repo_access.direct_fee_policy_repo(storage)
    gateway_repo = direct_repo_access.direct_gateway_state_repo(storage)

    assert isinstance(fee_repo, FakeFeeRepo)
    assert isinstance(gateway_repo, FakeGatewayRepo)
    assert captured["fee_db"] == "fake-db-manager"
    assert captured["gateway_db"] == "fake-db-manager"
