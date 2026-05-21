from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

import httpx

from src.core.config import Settings
from src.core.errors import AppError
from src.services.dashboard.service import DashboardService
from src.storage.analytics import GatewayDashboardProjectionRepository

OWNER_SELECTOR = "0x8da5cb5b"
PLATFORM_SIGNER_SELECTOR = "0xba92ddbc"
USDC_SELECTOR = "0x3e413bee"
PLATFORM_FEE_POOL_SELECTOR = "0x622aef9e"
BALANCE_OF_SELECTOR = "0x70a08231"
DECIMALS_SELECTOR = "0x313ce567"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
MONEY_QUANTUM = Decimal("0.000001")
NATIVE_DECIMALS = 18


class ContractRegistryChainReader(Protocol):
    def block_number(self) -> int: ...
    def read_address(self, contract_address: str, selector: str) -> str: ...
    def read_uint(self, contract_address: str, selector: str) -> int: ...
    def native_balance(self, address: str) -> int: ...
    def erc20_balance(self, token_address: str, holder_address: str) -> int: ...
    def erc20_decimals(self, token_address: str) -> int: ...


@dataclass(frozen=True)
class _ChainSnapshot:
    rpc_status: str
    latest_block: int | None
    actual_owner: str
    actual_platform_signer: str
    actual_usdc: str
    platform_fee_pool_atomic: int | None
    token_decimals: int
    native_balances: dict[str, int]
    usdc_balances: dict[str, int]


class JsonRpcContractRegistryChainReader:
    def __init__(self, rpc_url: str, *, timeout_sec: float = 10.0) -> None:
        self._rpc_url = rpc_url.strip()
        self._timeout_sec = timeout_sec

    def block_number(self) -> int:
        return int(self._rpc("eth_blockNumber", []), 16)

    def read_address(self, contract_address: str, selector: str) -> str:
        raw = self._eth_call(contract_address, selector)
        value = raw.removeprefix("0x").rjust(64, "0")
        return "0x" + value[-40:].lower()

    def read_uint(self, contract_address: str, selector: str) -> int:
        return int(self._eth_call(contract_address, selector), 16)

    def native_balance(self, address: str) -> int:
        return int(self._rpc("eth_getBalance", [address, "latest"]), 16)

    def erc20_balance(self, token_address: str, holder_address: str) -> int:
        encoded_address = holder_address.lower().removeprefix("0x").rjust(64, "0")
        return int(self._eth_call(token_address, f"{BALANCE_OF_SELECTOR}{encoded_address}"), 16)

    def erc20_decimals(self, token_address: str) -> int:
        return int(self._eth_call(token_address, DECIMALS_SELECTOR), 16)

    def _eth_call(self, contract_address: str, data: str) -> str:
        return str(
            self._rpc(
                "eth_call",
                [{"to": contract_address, "data": data}, "latest"],
            )
        )

    def _rpc(self, method: str, params: list[Any]) -> object:
        if not self._rpc_url:
            raise AppError(
                code="CONTRACT_REGISTRY_RPC_NOT_CONFIGURED",
                message="RPC_URL is required to read contract registry state.",
                status_code=503,
            )
        try:
            response = httpx.post(
                self._rpc_url,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
                timeout=self._timeout_sec,
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AppError(
                code="CONTRACT_REGISTRY_RPC_UNAVAILABLE",
                message="Unable to read contract registry state from RPC.",
                status_code=503,
            ) from exc
        if "error" in body:
            raise AppError(
                code="CONTRACT_REGISTRY_RPC_CALL_FAILED",
                message="RPC rejected contract registry state read.",
                status_code=503,
            )
        return body.get("result")


class ContractAddressRegistryService:
    def __init__(
        self,
        settings: Settings,
        dashboard_service: DashboardService,
        chain_reader: ContractRegistryChainReader,
        gateway_projection: GatewayDashboardProjectionRepository | None = None,
    ) -> None:
        self._settings = settings
        self._dashboard_service = dashboard_service
        self._chain_reader = chain_reader
        self._gateway_projection = gateway_projection

    def get_registry(self) -> dict[str, Any]:
        finance = self._safe_dict(self._dashboard_service.get_finance_overview)
        reconciliation = self._safe_dict(self._dashboard_service.get_reconciliation_detail)
        revenue_7d = self._safe_dict(lambda: self._dashboard_service.get_analytics_invocation_revenue("7d"))
        revenue_30d = self._safe_dict(lambda: self._dashboard_service.get_analytics_invocation_revenue("30d"))
        finance_snapshot = self._safe_call(
            lambda: self._gateway_projection.get_finance_snapshot() if self._gateway_projection else None
        )
        reconciliation_state = self._safe_call(
            lambda: self._gateway_projection.get_reconciliation_runtime_state() if self._gateway_projection else None
        )
        expected = self._expected_addresses()
        chain = self._read_chain_snapshot(expected)

        return {
            "network": {
                "env": self._environment_label(),
                "chainId": self._settings.chain_id,
                "chainName": self._settings.chain_name,
                "explorerBaseUrl": self._settings.explorer_base_url.rstrip("/"),
                "latestBlock": chain.latest_block,
                "rpcStatus": chain.rpc_status,
                "checkedAt": datetime.now(timezone.utc).isoformat(),
            },
            "contracts": self._build_contracts(expected, chain),
            "roles": self._build_roles(expected, chain),
            "contractChecks": self._build_contract_checks(expected, chain),
            "balances": {
                "vaultUsdc": self._format_atomic(chain.usdc_balances.get("synapseCore"), chain.token_decimals),
                "vaultNative": self._format_atomic(chain.native_balances.get("synapseCore"), NATIVE_DECIMALS),
                "treasurySafeUsdc": self._format_atomic(chain.usdc_balances.get("treasurySafe"), chain.token_decimals),
                "treasurySafeNative": self._format_atomic(chain.native_balances.get("treasurySafe"), NATIVE_DECIMALS),
                "platformFeePoolUsdc": self._format_atomic(chain.platform_fee_pool_atomic, chain.token_decimals),
                "ledgerPlatformFeeUsdc": self._snapshot_decimal(
                    finance_snapshot,
                    "platform_fee_balance_usdc",
                    finance.get("platformFeeBalanceUsdc"),
                ),
                "ledgerObligationUsdc": self._snapshot_decimal(
                    reconciliation_state,
                    "ledger_obligation_usdc",
                    reconciliation.get("ledgerObligationUsdc"),
                ),
                "vaultLedgerDeltaUsdc": self._snapshot_decimal(
                    reconciliation_state,
                    "delta_usdc",
                    reconciliation.get("reconciliationDeltaUsdc") or finance.get("vaultLedgerDeltaUsdc"),
                ),
            },
            "feeSummary": {
                "todayPlatformFeeUsdc": self._snapshot_decimal(
                    finance_snapshot,
                    "today_platform_fee_earned_usdc",
                    finance.get("todayPlatformFeeEarnedUsdc") or "0.000000",
                ),
                "sevenDayPlatformFeeUsdc": str(revenue_7d.get("platformFeeUsdc") or "0.000000"),
                "thirtyDayPlatformFeeUsdc": str(revenue_30d.get("platformFeeUsdc") or "0.000000"),
            },
        }

    @staticmethod
    def _safe_dict(loader: Any) -> dict[str, Any]:
        try:
            value = loader()
        except Exception:
            return {}
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _safe_call(loader: Any) -> Any:
        try:
            return loader()
        except Exception:
            return None

    @classmethod
    def _snapshot_decimal(cls, snapshot: Any, attribute: str, fallback: Any) -> str | None:
        value = getattr(snapshot, attribute, None) if snapshot is not None else None
        if value is not None:
            return cls._format_decimal(value)
        if fallback is None:
            return None
        return str(fallback)

    def _expected_addresses(self) -> dict[str, str]:
        return {
            "synapseCore": self._normalize_address(self._settings.synapse_core_address),
            "usdc": self._normalize_address(self._settings.usdc_token_address),
            "treasurySafe": self._normalize_address(self._settings.platform_treasury_safe_address),
            "ledgerSigner": self._normalize_address(self._settings.platform_treasury_ledger_signer_address),
            "withdrawSigner": self._normalize_address(self._settings.withdraw_signer_address),
        }

    def _read_chain_snapshot(self, expected: dict[str, str]) -> _ChainSnapshot:
        token_decimals = self._settings.platform_fee_token_decimals
        addresses = {key: value for key, value in expected.items() if self._is_address(value)}
        try:
            if self._is_address(expected["usdc"]):
                token_decimals = self._chain_reader.erc20_decimals(expected["usdc"])
            native_balances = {
                key: self._chain_reader.native_balance(address)
                for key, address in addresses.items()
            }
            usdc_balances = {
                key: self._chain_reader.erc20_balance(expected["usdc"], address)
                for key, address in addresses.items()
                if self._is_address(expected["usdc"])
            }
            return _ChainSnapshot(
                rpc_status="healthy",
                latest_block=self._chain_reader.block_number(),
                actual_owner=self._chain_reader.read_address(expected["synapseCore"], OWNER_SELECTOR) if self._is_address(expected["synapseCore"]) else "",
                actual_platform_signer=self._chain_reader.read_address(expected["synapseCore"], PLATFORM_SIGNER_SELECTOR) if self._is_address(expected["synapseCore"]) else "",
                actual_usdc=self._chain_reader.read_address(expected["synapseCore"], USDC_SELECTOR) if self._is_address(expected["synapseCore"]) else "",
                platform_fee_pool_atomic=self._chain_reader.read_uint(expected["synapseCore"], PLATFORM_FEE_POOL_SELECTOR) if self._is_address(expected["synapseCore"]) else None,
                token_decimals=token_decimals,
                native_balances=native_balances,
                usdc_balances=usdc_balances,
            )
        except Exception:
            return _ChainSnapshot(
                rpc_status="degraded",
                latest_block=None,
                actual_owner="unavailable",
                actual_platform_signer="unavailable",
                actual_usdc="unavailable",
                platform_fee_pool_atomic=None,
                token_decimals=token_decimals,
                native_balances={},
                usdc_balances={},
            )

    def _build_contracts(self, expected: dict[str, str], chain: _ChainSnapshot) -> list[dict[str, str]]:
        return [
            {
                "key": "synapseCore",
                "label": "SynapseCore",
                "address": expected["synapseCore"],
                "expectedAddress": expected["synapseCore"],
                "explorerUrl": self._address_url(expected["synapseCore"]),
                "status": "warning" if chain.rpc_status == "degraded" else "ok",
            },
            {
                "key": "usdc",
                "label": "USDC",
                "address": expected["usdc"],
                "expectedAddress": expected["usdc"],
                "explorerUrl": self._address_url(expected["usdc"]),
                "status": self._check_status(expected["usdc"], chain.actual_usdc),
            },
        ]

    def _build_roles(self, expected: dict[str, str], chain: _ChainSnapshot) -> list[dict[str, str]]:
        roles = [
            ("ledgerSigner", "Ledger deployer / Safe owner signer", "Hardware wallet that signs deployments and owns the Safe.", "safe"),
            ("treasurySafe", "Treasury Safe / contract owner", "Safe treasury expected to own SynapseCore.", "safe"),
            ("withdrawSigner", "KMS withdraw signer", "KMS-derived signer expected to match SynapseCore.platformSigner().", "kms"),
            ("synapseCore", "SynapseCore", "On-chain USDC vault and settlement contract.", "env"),
            ("usdc", "Arbitrum One USDC", "Official USDC token used for settlement.", "env"),
        ]
        return [
            {
                "key": key,
                "label": label,
                "address": expected[key],
                "purpose": purpose,
                "source": source,
                "explorerUrl": self._address_url(expected[key]),
                "nativeBalance": self._format_atomic(chain.native_balances.get(key), NATIVE_DECIMALS),
                "usdcBalance": self._format_atomic(chain.usdc_balances.get(key), chain.token_decimals),
                "status": self._role_status(key, chain),
            }
            for key, label, purpose, source in roles
        ]

    def _build_contract_checks(self, expected: dict[str, str], chain: _ChainSnapshot) -> list[dict[str, str]]:
        return [
            {
                "key": "owner",
                "label": "SynapseCore.owner()",
                "expected": expected["treasurySafe"],
                "actual": chain.actual_owner,
                "status": self._check_status(expected["treasurySafe"], chain.actual_owner, degraded_is_critical=True),
            },
            {
                "key": "platformSigner",
                "label": "SynapseCore.platformSigner()",
                "expected": expected["withdrawSigner"],
                "actual": chain.actual_platform_signer,
                "status": self._check_status(expected["withdrawSigner"], chain.actual_platform_signer, degraded_is_critical=True),
            },
            {
                "key": "usdc",
                "label": "SynapseCore.usdc()",
                "expected": expected["usdc"],
                "actual": chain.actual_usdc,
                "status": self._check_status(expected["usdc"], chain.actual_usdc, degraded_is_critical=True),
            },
        ]

    def _role_status(self, key: str, chain: _ChainSnapshot) -> str:
        if chain.rpc_status == "degraded":
            return "warning"
        native = self._format_atomic(chain.native_balances.get(key), NATIVE_DECIMALS)
        usdc = self._format_atomic(chain.usdc_balances.get(key), chain.token_decimals)
        if key in {"ledgerSigner", "withdrawSigner"}:
            if self._decimal_or_zero(native) < self._decimal_or_zero(self._settings.contract_registry_min_signer_native_balance):
                return "warning"
            if self._decimal_or_zero(usdc) > Decimal("0"):
                return "warning"
        return "ok"

    @staticmethod
    def _check_status(expected: str, actual: str, *, degraded_is_critical: bool = False) -> str:
        if actual == "unavailable":
            return "critical" if degraded_is_critical else "warning"
        if not expected or not actual:
            return "critical"
        return "ok" if expected.lower() == actual.lower() else "critical"

    def _address_url(self, address: str) -> str:
        if not address:
            return ""
        return f"{self._settings.explorer_base_url.rstrip('/')}/address/{address}"

    @staticmethod
    def _format_atomic(value: int | None, decimals: int) -> str:
        if value is None:
            return "unavailable"
        scale = Decimal(10) ** Decimal(decimals)
        return (Decimal(value) / scale).quantize(MONEY_QUANTUM).to_eng_string()

    @staticmethod
    def _format_decimal(value: Any) -> str:
        try:
            decimal_value = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return "unavailable"
        return decimal_value.quantize(MONEY_QUANTUM).to_eng_string()

    @staticmethod
    def _decimal_or_zero(value: str) -> Decimal:
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return Decimal("0")

    @staticmethod
    def _normalize_address(value: str) -> str:
        return str(value or "").strip()

    @staticmethod
    def _is_address(value: str) -> bool:
        candidate = str(value or "").strip()
        return len(candidate) == 42 and candidate.startswith("0x") and candidate != ZERO_ADDRESS

    def _environment_label(self) -> str:
        env = str(self._settings.environment or "local").strip().lower()
        if env in {"prod", "production"}:
            return "prod"
        if env in {"staging", "stage"}:
            return "staging"
        return "local"
