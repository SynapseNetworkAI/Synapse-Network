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

    def read_deposit_intents(self) -> Any:
        value = self.collections.get("deposit_intents")
        if isinstance(value, dict):
            return value.get("intents")
        return value

    def write_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        self.collections["deposit_intents"] = rows

    def read_refund_intents(self) -> Any:
        value = self.collections.get("refund_intents")
        return value.get("rows") if isinstance(value, dict) else value

    def write_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self.collections["refund_intents"] = {"rows": rows, "updatedAt": int(updated_at)}

    def read_withdrawal_intents(self) -> Any:
        value = self.collections.get("provider_withdrawal_intents")
        return value.get("rows") if isinstance(value, dict) else value

    def write_withdrawal_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self.collections["provider_withdrawal_intents"] = {"rows": rows, "updatedAt": int(updated_at)}

    def read_balance_ledger(self) -> Any:
        return self.collections.get("balance_ledger")

    def write_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        self.collections["balance_ledger"] = ledger

    def read_router_config_rows(self) -> Any:
        value = self.collections.get("router_config")
        return value.get("rows") if isinstance(value, dict) else value

    def write_router_config_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self.collections["router_config"] = {"rows": rows, "updatedAt": int(updated_at)}

    def read_usage_log_rows(self) -> Any:
        return self.collections.get("usage_log")

    def write_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.collections["usage_log"] = rows

    def append_audit_row(self, row: Dict[str, Any]) -> None:
        self.append_calls.append(("audit_log", row))

    def read_processed_deposit_event_keys(self) -> List[str]:
        value = self.collections.get("deposit_event_processed")
        if isinstance(value, dict) and isinstance(value.get("keys"), list):
            return [str(item) for item in value.get("keys")]
        if isinstance(value, list):
            return [str(item) for item in value]
        return []

    def write_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        self.collections["deposit_event_processed"] = {"keys": keys, "updatedAt": int(updated_at)}

    def read_service_registry_rows(self) -> Any:
        return self.collections.get("service_registry")

    def write_service_registry_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.collections["service_registry"] = rows

    def read_service_target_health_rows(self) -> Any:
        return self.collections.get("service_target_health")

    def write_service_target_health_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.collections["service_target_health"] = rows

    def read_service_target_health_history_rows(self) -> Any:
        return self.collections.get("service_target_health_history")

    def write_service_target_health_history_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.collections["service_target_health_history"] = rows

    def read_credential_rows(self, credential_type: str) -> List[Dict[str, Any]]:
        key = "seller_secrets" if credential_type == "seller" else "buyer_credentials"
        value = self.collections.get(key)
        if isinstance(value, dict) and isinstance(value.get("credentials"), list):
            return [row for row in value["credentials"] if isinstance(row, dict)]
        return []

    def write_credential_rows(self, credential_type: str, rows: List[Dict[str, Any]]) -> None:
        key = "seller_secrets" if credential_type == "seller" else "buyer_credentials"
        self.collections[key] = {"credentials": rows, "updatedAt": 0}


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
    assert repo.load_withdrawal_intents() == [{"id": "wd-1", "status": "REQUESTED"}]

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

    repo.save_collection("seller_secrets", {"credentials": [{"id": "sec-1"}]})
    assert repo.load_collection("seller_secrets") == {"credentials": [{"id": "sec-1"}], "updatedAt": 0}

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
