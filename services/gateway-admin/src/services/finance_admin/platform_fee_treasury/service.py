from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
from typing import Protocol
from uuid import uuid4

import httpx

from src.core.config import Settings
from src.core.errors import AppError, BadRequestError
from src.domain import AdminActionAudit
from src.domain.enums import AuditResultStatus
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore

WITHDRAW_PLATFORM_FEES_SELECTOR = "0x6aa21416"
OWNER_SELECTOR = "0x8da5cb5b"
PLATFORM_FEE_POOL_SELECTOR = "0x622aef9e"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
MONEY_QUANTUM = Decimal("0.000001")
ETH_ADDRESS_LENGTH = 42
ERR_DRAFT_ALREADY_CREATED = "Platform fee withdrawal request was already drafted"
ERR_OWNER_MISMATCH = "SynapseCore.owner() must equal PLATFORM_TREASURY_SAFE_ADDRESS"
ERR_INSUFFICIENT_FEE_POOL = "Requested amount exceeds SynapseCore.platformFeePool()"
ERR_AMOUNT_DECIMAL = "amountUsdc must be a positive decimal string"
ERR_AMOUNT_POSITIVE = "amountUsdc must be greater than 0"
ERR_AMOUNT_PRECISION = "amountUsdc supports at most 6 decimal places"
ERR_SELECTOR_MISMATCH = "Safe draft selector must be withdrawPlatformFees(uint256)"
ERR_SAFE_AMOUNT_MISMATCH = "Safe draft amount does not match request amount"
ERR_SAFE_TARGET_MISSING = "Safe draft target SynapseCore address is not configured"
ERR_ADDRESS_INVALID = "Required treasury address must be configured as an Ethereum address"
ERR_ADDRESS_ZERO = "Required treasury address cannot be the zero address"


class PlatformFeeChainReader(Protocol):
    def read_owner(self, contract_address: str) -> str: ...
    def read_platform_fee_pool(self, contract_address: str) -> int: ...


@dataclass(frozen=True)
class SafeTransactionDraft:
    to: str
    value: str
    data: str
    operation: int


@dataclass(frozen=True)
class PlatformFeeTreasuryDraft:
    request_id: str
    amount_usdc: str
    amount_atomic: str
    safe_address: str
    ledger_signer_address: str
    synapse_core_address: str
    selector: str
    calldata_hash: str
    platform_fee_pool_atomic: str
    safe_tx: SafeTransactionDraft


@dataclass(frozen=True)
class _TreasuryConfig:
    safe_address: str
    ledger_signer_address: str
    synapse_core_address: str


@dataclass(frozen=True)
class _AuditEntry:
    draft_request_id: str
    amount_usdc: str
    amount_atomic: int
    result_status: AuditResultStatus
    request_id: str | None
    detail: dict
    error_code: str | None = None
    after: dict | None = None


class JsonRpcPlatformFeeChainReader:
    def __init__(self, rpc_url: str, *, timeout_sec: float = 10.0) -> None:
        self._rpc_url = rpc_url.strip()
        self._timeout_sec = timeout_sec

    def read_owner(self, contract_address: str) -> str:
        raw = self._eth_call(contract_address, OWNER_SELECTOR)
        value = raw.removeprefix("0x").rjust(64, "0")
        return "0x" + value[-40:].lower()

    def read_platform_fee_pool(self, contract_address: str) -> int:
        raw = self._eth_call(contract_address, PLATFORM_FEE_POOL_SELECTOR)
        return int(raw, 16)

    def _eth_call(self, contract_address: str, data: str) -> str:
        if not self._rpc_url:
            raise AppError(
                code="PLATFORM_TREASURY_RPC_NOT_CONFIGURED",
                message="RPC_URL is required to validate platform fee Safe drafts.",
                status_code=503,
            )
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": contract_address, "data": data}, "latest"],
        }
        try:
            response = httpx.post(self._rpc_url, json=payload, timeout=self._timeout_sec)
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise AppError(
                code="PLATFORM_TREASURY_RPC_UNAVAILABLE",
                message="Unable to read SynapseCore treasury state from RPC.",
                status_code=503,
            ) from exc
        if "error" in body:
            raise AppError(
                code="PLATFORM_TREASURY_RPC_CALL_FAILED",
                message="RPC rejected SynapseCore treasury state read.",
                status_code=503,
                data={"rpcError": body.get("error")},
            )
        result = str(body.get("result") or "").strip()
        if not result.startswith("0x"):
            raise AppError(
                code="PLATFORM_TREASURY_RPC_INVALID_RESPONSE",
                message="RPC returned an invalid SynapseCore treasury response.",
                status_code=503,
            )
        return result


class PlatformFeeTreasuryService:
    def __init__(
        self,
        store: AdminStore,
        settings: Settings,
        chain_reader: PlatformFeeChainReader,
    ) -> None:
        self._store = store
        self._settings = settings
        self._chain_reader = chain_reader

    def create_safe_draft(
        self,
        *,
        amount_usdc: str,
        reason: str,
        operator: AdminIdentity,
        request_id: str | None,
        http_request_id: str | None,
    ) -> PlatformFeeTreasuryDraft:
        draft_request_id = self._normalize_request_id(request_id)
        if self._has_successful_draft(draft_request_id):
            raise BadRequestError(ERR_DRAFT_ALREADY_CREATED)

        amount_atomic, normalized_amount = self._parse_amount(amount_usdc)
        treasury = self._load_treasury_config()
        self._assert_safe_owns_core(
            treasury,
            amount_usdc=normalized_amount,
            amount_atomic=amount_atomic,
            reason=reason,
            operator=operator,
            draft_request_id=draft_request_id,
            http_request_id=http_request_id,
        )
        pool_atomic = self._assert_sufficient_fee_pool(
            treasury,
            amount_usdc=normalized_amount,
            amount_atomic=amount_atomic,
            reason=reason,
            operator=operator,
            draft_request_id=draft_request_id,
            http_request_id=http_request_id,
        )
        calldata = self._build_validated_calldata(treasury, amount_atomic)
        calldata_hash = "0x" + hashlib.sha256(bytes.fromhex(calldata.removeprefix("0x"))).hexdigest()
        draft = PlatformFeeTreasuryDraft(
            request_id=draft_request_id,
            amount_usdc=normalized_amount,
            amount_atomic=str(amount_atomic),
            safe_address=treasury.safe_address,
            ledger_signer_address=treasury.ledger_signer_address,
            synapse_core_address=treasury.synapse_core_address,
            selector=WITHDRAW_PLATFORM_FEES_SELECTOR,
            calldata_hash=calldata_hash,
            platform_fee_pool_atomic=str(pool_atomic),
            safe_tx=SafeTransactionDraft(
                to=treasury.synapse_core_address,
                value="0",
                data=calldata,
                operation=0,
            ),
        )
        self._append_success_audit(
            operator,
            draft=draft,
            reason=reason,
            request_id=http_request_id,
        )
        return draft

    def _load_treasury_config(self) -> _TreasuryConfig:
        return _TreasuryConfig(
            safe_address=self._require_address(
                self._settings.platform_treasury_safe_address,
                "PLATFORM_TREASURY_SAFE_ADDRESS",
            ),
            ledger_signer_address=self._require_address(
                self._settings.platform_treasury_ledger_signer_address,
                "PLATFORM_TREASURY_LEDGER_SIGNER_ADDRESS",
            ),
            synapse_core_address=self._require_address(
                self._settings.synapse_core_address,
                "SYNAPSE_CORE_ADDRESS",
            ),
        )

    def _assert_safe_owns_core(
        self,
        treasury: _TreasuryConfig,
        *,
        amount_usdc: str,
        amount_atomic: int,
        reason: str,
        operator: AdminIdentity,
        draft_request_id: str,
        http_request_id: str | None,
    ) -> None:
        owner = self._chain_reader.read_owner(treasury.synapse_core_address)
        if owner == treasury.safe_address:
            return
        self._append_audit(
            operator,
            _AuditEntry(
                draft_request_id=draft_request_id,
                amount_usdc=amount_usdc,
                amount_atomic=amount_atomic,
                result_status=AuditResultStatus.FAILURE,
                request_id=http_request_id,
                error_code="PLATFORM_TREASURY_OWNER_MISMATCH",
                detail={
                    "reason": reason.strip(),
                    "expectedSafe": treasury.safe_address,
                    "actualOwner": owner,
                },
            ),
        )
        raise BadRequestError(ERR_OWNER_MISMATCH)

    def _assert_sufficient_fee_pool(
        self,
        treasury: _TreasuryConfig,
        *,
        amount_usdc: str,
        amount_atomic: int,
        reason: str,
        operator: AdminIdentity,
        draft_request_id: str,
        http_request_id: str | None,
    ) -> int:
        pool_atomic = self._chain_reader.read_platform_fee_pool(treasury.synapse_core_address)
        if amount_atomic <= pool_atomic:
            return pool_atomic
        self._append_audit(
            operator,
            _AuditEntry(
                draft_request_id=draft_request_id,
                amount_usdc=amount_usdc,
                amount_atomic=amount_atomic,
                result_status=AuditResultStatus.FAILURE,
                request_id=http_request_id,
                error_code="PLATFORM_TREASURY_INSUFFICIENT_FEE_POOL",
                detail={
                    "reason": reason.strip(),
                    "platformFeePoolAtomic": str(pool_atomic),
                },
            ),
        )
        raise BadRequestError(ERR_INSUFFICIENT_FEE_POOL)

    def _build_validated_calldata(self, treasury: _TreasuryConfig, amount_atomic: int) -> str:
        calldata = self._build_withdraw_calldata(amount_atomic)
        self._verify_safe_tx(treasury.synapse_core_address, calldata, amount_atomic)
        return calldata

    def _parse_amount(self, value: str) -> tuple[int, str]:
        try:
            amount = Decimal(str(value).strip())
        except (InvalidOperation, ValueError) as exc:
            raise BadRequestError(ERR_AMOUNT_DECIMAL) from exc
        if amount <= 0:
            raise BadRequestError(ERR_AMOUNT_POSITIVE)
        if amount.quantize(MONEY_QUANTUM) != amount:
            raise BadRequestError(ERR_AMOUNT_PRECISION)
        scale = Decimal(10) ** int(self._settings.platform_fee_token_decimals)
        amount_atomic = int((amount * scale).to_integral_exact())
        return amount_atomic, f"{amount:.6f}"

    def _has_successful_draft(self, draft_request_id: str) -> bool:
        audits = self._store.audit.list_actions(
            action_type="platform_fee_withdrawal.safe_draft_created",
            result_status=AuditResultStatus.SUCCESS.value,
            limit=1000,
        )
        return any(audit.resource_id == draft_request_id for audit in audits)

    def _append_success_audit(
        self,
        operator: AdminIdentity,
        *,
        draft: PlatformFeeTreasuryDraft,
        reason: str,
        request_id: str | None,
    ) -> None:
        self._append_audit(
            operator,
            _AuditEntry(
                draft_request_id=draft.request_id,
                amount_usdc=draft.amount_usdc,
                amount_atomic=int(draft.amount_atomic),
                result_status=AuditResultStatus.SUCCESS,
                request_id=request_id,
                detail={
                    "reason": reason.strip(),
                    "safeAddress": draft.safe_address,
                    "ledgerSignerAddress": draft.ledger_signer_address,
                    "synapseCoreAddress": draft.synapse_core_address,
                    "selector": draft.selector,
                    "calldataHash": draft.calldata_hash,
                    "platformFeePoolAtomic": draft.platform_fee_pool_atomic,
                },
                after={
                    "safeTx": {
                        "to": draft.safe_tx.to,
                        "value": draft.safe_tx.value,
                        "data": draft.safe_tx.data,
                        "operation": draft.safe_tx.operation,
                    },
                },
            ),
        )

    def _append_audit(
        self,
        operator: AdminIdentity,
        entry: _AuditEntry,
    ) -> None:
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="platform_fee_withdrawal.safe_draft_created",
                result_status=entry.result_status,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                request_id=entry.request_id,
                resource_type="platform_fee_withdrawal",
                resource_id=entry.draft_request_id,
                error_code=entry.error_code,
                before={
                    "amountUsdc": entry.amount_usdc,
                    "amountAtomic": str(entry.amount_atomic),
                },
                after=entry.after or {},
                detail=entry.detail,
                created_at=datetime.now(timezone.utc),
            )
        )

    @staticmethod
    def _build_withdraw_calldata(amount_atomic: int) -> str:
        encoded_amount = hex(amount_atomic).removeprefix("0x").rjust(64, "0")
        return WITHDRAW_PLATFORM_FEES_SELECTOR + encoded_amount

    @staticmethod
    def _decoded_amount(calldata: str) -> int:
        normalized = calldata.removeprefix("0x")
        return int(normalized[8:72], 16)

    def _verify_safe_tx(self, core_address: str, calldata: str, amount_atomic: int) -> None:
        if not calldata.startswith(WITHDRAW_PLATFORM_FEES_SELECTOR):
            raise BadRequestError(ERR_SELECTOR_MISMATCH)
        if self._decoded_amount(calldata) != amount_atomic:
            raise BadRequestError(ERR_SAFE_AMOUNT_MISMATCH)
        if not core_address or core_address == ZERO_ADDRESS:
            raise BadRequestError(ERR_SAFE_TARGET_MISSING)

    @staticmethod
    def _normalize_request_id(value: str | None) -> str:
        normalized = str(value or "").strip()
        return normalized or f"platform-fee-{uuid4()}"

    @staticmethod
    def _require_address(value: str, _name: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized.startswith("0x") or len(normalized) != ETH_ADDRESS_LENGTH:
            raise BadRequestError(ERR_ADDRESS_INVALID)
        if normalized == ZERO_ADDRESS:
            raise BadRequestError(ERR_ADDRESS_ZERO)
        return normalized
