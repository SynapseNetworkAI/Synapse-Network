# pyright: reportMissingImports=false

from typing import Any, Dict, List

from src.storage.credential_repository import CredentialRepository
from src.storage.finance_repository import FinanceRepository
from src.storage.registry_repository import RegistryRepository


class StubStorage:
    def __init__(self):
        self.collections: Dict[str, Any] = {}
        self.append_calls: List[tuple[str, Dict[str, Any]]] = []

    def get_collection(self, collection_name: str) -> Any:
        return self.collections.get(collection_name)

    def save_collection(self, collection_name: str, data: Any) -> None:
        self.collections[collection_name] = data

    def append_to_collection(self, collection_name: str, item: Dict[str, Any]) -> None:
        self.append_calls.append((collection_name, item))


class StubStorageWithAudit(StubStorage):
    directory = "/tmp/synapse-test"

    def read_audit_rows(self, owner_wallet: str, limit: int) -> Any:
        return [{"owner": owner_wallet, "limit": limit}, "skip-me"]


class StubStorageAuditError(StubStorage):
    def read_audit_rows(self, owner_wallet: str, limit: int) -> Any:
        raise RuntimeError("boom")


def test_finance_repository_normalizes_and_saves() -> None:
    storage = StubStorage()
    storage.collections["deposit_intents"] = {"intents": [{"id": "dep-1"}, "skip"]}
    storage.collections["refund_intents"] = {"rows": [{"id": "ref-1"}, 12]}
    storage.collections["provider_withdrawal_intents"] = {"rows": [{"id": "wd-1"}]}
    storage.collections["balance_ledger"] = {"buyers": {"0x1": 1.0}}
    storage.collections["deposit_event_processed"] = {"keys": [1, "k2"]}

    repo = FinanceRepository(storage)

    assert repo.load_deposit_intents() == [{"id": "dep-1"}]
    assert repo.load_refund_intents() == [{"id": "ref-1"}]
    assert repo.load_withdrawal_intents() == [{"id": "wd-1", "status": "PENDING"}]

    ledger = repo.load_balance_ledger()
    assert ledger["buyers"] == {"0x1": 1.0}
    assert ledger["sellers"] == {}
    assert ledger["sellersLocked"] == {}
    assert abs(float(ledger["platform"]["feeAccrued"]) - 0.0) < 1e-9
    assert isinstance(ledger["updatedAt"], int)

    assert repo.load_processed_deposit_event_keys() == ["1", "k2"]

    repo.save_deposit_intents([{"id": "dep-2"}])
    repo.save_refund_intents([{"id": "ref-2"}], 100)
    repo.save_withdrawal_intents([{"id": "wd-2", "status": "SUCCESS"}])
    repo.save_balance_ledger({"buyers": {}, "sellers": {}, "sellersLocked": {}, "platform": {"feeAccrued": 1.0}})
    repo.save_router_config_rows([{"ownerAddress": "0x1"}], 200)
    repo.save_usage_log_rows([{"id": "usage-1"}])
    repo.save_processed_deposit_event_keys(["k3"], 300)
    repo.append_audit_log({"event": "test"})

    assert storage.collections["deposit_intents"] == [{"id": "dep-2"}]
    assert storage.collections["refund_intents"] == {"rows": [{"id": "ref-2"}], "updatedAt": 100}
    assert storage.collections["router_config"] == {"rows": [{"ownerAddress": "0x1"}], "updatedAt": 200}
    assert storage.collections["usage_log"] == [{"id": "usage-1"}]
    assert storage.collections["deposit_event_processed"] == {"keys": ["k3"], "updatedAt": 300}
    assert isinstance(storage.collections["provider_withdrawal_intents"]["updatedAt"], int)
    assert isinstance(storage.collections["balance_ledger"]["updatedAt"], int)
    assert storage.append_calls == [("audit_log", {"event": "test"})]


def test_registry_repository_filters_non_dict_rows() -> None:
    storage = StubStorage()
    storage.collections["service_registry"] = [{"id": "svc-1"}, "skip"]
    storage.collections["service_target_health"] = [{"serviceId": "svc-1"}, None]
    storage.collections["service_target_health_history"] = [{"serviceId": "svc-1", "ok": True}, 99]

    repo = RegistryRepository(storage)

    assert repo.load_service_registry() == [{"id": "svc-1"}]
    assert repo.load_target_health_rows() == [{"serviceId": "svc-1"}]
    assert repo.load_target_health_history_rows() == [{"serviceId": "svc-1", "ok": True}]

    repo.save_service_registry([{"id": "svc-2"}])
    repo.save_target_health_rows([{"serviceId": "svc-2"}])
    repo.save_target_health_history_rows([{"serviceId": "svc-2", "ok": False}])

    assert storage.collections["service_registry"] == [{"id": "svc-2"}]
    assert storage.collections["service_target_health"] == [{"serviceId": "svc-2"}]
    assert storage.collections["service_target_health_history"] == [{"serviceId": "svc-2", "ok": False}]


def test_credential_repository_audit_capability_and_directory() -> None:
    storage = StubStorageWithAudit()
    repo = CredentialRepository(storage)

    repo.save_collection("seller_secrets", {"rows": [{"id": "sec-1"}]})
    assert repo.load_collection("seller_secrets") == {"rows": [{"id": "sec-1"}]}

    repo.append_audit_log({"event": "credential-updated"})
    assert storage.append_calls == [("audit_log", {"event": "credential-updated"})]

    ok, rows = repo.read_audit_rows(owner_wallet="0xabc", limit=10)
    assert ok is True
    assert rows == [{"owner": "0xabc", "limit": 10}]
    assert repo.storage_directory() == "/tmp/synapse-test"


def test_credential_repository_handles_missing_or_failed_audit_reader() -> None:
    no_reader_repo = CredentialRepository(StubStorage())
    ok_missing, rows_missing = no_reader_repo.read_audit_rows(owner_wallet="0xabc", limit=5)
    assert ok_missing is False
    assert rows_missing == []
    assert no_reader_repo.storage_directory() == ""

    error_repo = CredentialRepository(StubStorageAuditError())
    ok_error, rows_error = error_repo.read_audit_rows(owner_wallet="0xabc", limit=5)
    assert ok_error is False
    assert rows_error == []
