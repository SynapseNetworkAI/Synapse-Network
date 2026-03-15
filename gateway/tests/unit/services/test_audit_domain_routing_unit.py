# pyright: reportMissingImports=false

import sys
import importlib.util
from pathlib import Path
from types import SimpleNamespace

try:
    import jwt as _jwt  # noqa: F401
except ModuleNotFoundError:
    sys.modules["jwt"] = SimpleNamespace(decode=lambda *args, **kwargs: {})

_CREDENTIAL_SERVICE_PATH = (
    Path(__file__).resolve().parents[3] / "src" / "services" / "platform" / "credential_service.py"
)
_spec = importlib.util.spec_from_file_location("credential_service_for_tests", _CREDENTIAL_SERVICE_PATH)
if _spec is None or _spec.loader is None:
    raise RuntimeError("failed to load credential_service module for tests")
credential_service = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(credential_service)

from src.services.balance_mixins.audit import BalanceAuditMixin


class _DummyFinanceAuditService(BalanceAuditMixin):
    def __init__(self, storage):
        self.storage = storage


def test_credential_audit_routes_to_system_domain(temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"

    credential_service.append_audit_log(
        temp_storage,
        "SELLER_SECRET_ISSUED",
        owner,
        {
            "resourceType": "credential",
            "resourceId": "secret-1",
            "resultStatus": "success",
            "requestId": "req-system-1",
        },
    )

    logs = credential_service.read_audit_log(temp_storage, owner_wallet=owner.lower(), limit=20)
    assert len(logs) == 1
    assert logs[0]["domain"] == "system"
    assert logs[0]["details"]["resourceType"] == "credential"

    system_rows = temp_storage.get_collection("system_audit_log")
    finance_rows = temp_storage.get_collection("audit_log")
    assert isinstance(system_rows, list) and len(system_rows) == 1
    assert isinstance(finance_rows, list) and len(finance_rows) == 0


def test_finance_audit_routes_to_finance_domain(temp_storage):
    owner = "0xD856907D7E35A8F9BD225859A59E58577147A092"
    service = _DummyFinanceAuditService(temp_storage)

    service._append_financial_audit(
        "FINANCE_RATE_LIMIT_HIT",
        owner,
        {
            "businessType": "charge",
            "riskLevel": "yellow",
            "resultStatus": "rejected",
            "requestId": "req-finance-1",
        },
    )

    finance_rows = temp_storage.get_collection("audit_log")
    system_rows = temp_storage.get_collection("system_audit_log")
    assert isinstance(finance_rows, list) and len(finance_rows) == 1
    assert finance_rows[0]["domain"] == "finance"
    assert isinstance(system_rows, list) and len(system_rows) == 0
