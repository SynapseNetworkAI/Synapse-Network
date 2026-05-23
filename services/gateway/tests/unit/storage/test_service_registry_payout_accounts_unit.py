from __future__ import annotations

from typing import Any, cast

from src.domain.service_contract import ServiceDefinitionRecord
from src.storage.postgres.repositories.service_registry_repository import ServiceRegistryRepository


class FakeCursor:
    def __init__(self) -> None:
        self.executed: list[tuple[str, Any]] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))


def test_upsert_provider_payout_account_normalizes_payout_address_lowercase() -> None:
    repo = ServiceRegistryRepository(db=cast(Any, object()))
    cur = FakeCursor()
    row = ServiceDefinitionRecord(
        serviceId="svc_sentiment",
        ownerAddress="0xabc",
        payoutAccount={
            "payoutAddress": "0xB12367b041F8244F24a0311bDd8daAd52FAB8DA8",
            "chainId": 42161,
            "settlementCurrency": "USDC",
        },
    )

    repo._upsert_provider_payout_account(cur, row, "provider:0xdef", "created", "updated")

    assert len(cur.executed) == 1
    payout_params = cur.executed[0][1]
    assert payout_params[2] == "0xb12367b041f8244f24a0311bdd8daad52fab8da8"
    assert payout_params[0] == repo._payout_account_id("provider:0xdef", payout_params[2], 42161)
