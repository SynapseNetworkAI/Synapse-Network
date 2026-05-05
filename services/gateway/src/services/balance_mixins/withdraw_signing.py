import hashlib
import logging
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.services.balance_mixins.withdraw_ticket_signers import (
    WithdrawSignerCapability,
    WithdrawSignerConfig,
    require_withdraw_signer_config,
    sign_withdraw_ticket,
    withdraw_signer_capability,
)
from src.utils.money import usdc_decimal_to_atomic

logger = logging.getLogger(__name__)


def _web3_class():
    try:
        from web3 import Web3  # type: ignore[import-not-found]

        return Web3
    except Exception:  # pragma: no cover
        return None

Account: Any
encode_typed_data: Any
encode_structured_data: Any

try:
    from eth_account import Account  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    Account = None

try:
    from eth_account.messages import encode_typed_data  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    encode_typed_data = None

try:
    from eth_account.messages import encode_structured_data as _encode_structured_data  # type: ignore[import-not-found]  # because older eth-account exposes legacy encoder here
    encode_structured_data = _encode_structured_data
except Exception:  # pragma: no cover
    encode_structured_data = None

WITHDRAW_DEADLINE_SEC_MIN = 60
WITHDRAW_DEADLINE_SEC_MAX = 86400
WITHDRAW_DEADLINE_SEC_DEFAULT = 1800
USDC_DECIMALS = 18
EXPECTED_STAGING_CHAIN_ID = 421614


def _log_chain_rpc_unavailable(context: str, exc: Exception) -> None:
    logger.error(
        "alert_trigger=CHAIN_RPC_UNAVAILABLE env=%s context=%s chainIdExpected=%s "
        "rpcTimeoutSec=%s errorClass=%s",
        settings.environment,
        context,
        EXPECTED_STAGING_CHAIN_ID,
        settings.rpc_request_timeout_sec,
        exc.__class__.__name__,
    )


class BalanceWithdrawSigningMixin:
    def provider_withdraw_capability(self) -> WithdrawSignerCapability:
        web3_class = _web3_class()
        contract_address = normalize_wallet(settings.router_address)

        if web3_class is None or Account is None:
            return WithdrawSignerCapability(
                ticket_signing_enabled=False,
                code="CHAIN_SDK_NOT_INSTALLED",
                message="web3 and eth-account are required to issue withdrawal tickets.",
                signer_mode=getattr(settings, "withdraw_signer_mode", "local_private_key"),
                contract_address=contract_address or None,
            )
        if encode_typed_data is None and encode_structured_data is None:
            return WithdrawSignerCapability(
                ticket_signing_enabled=False,
                code="CHAIN_SDK_NOT_INSTALLED",
                message="eth-account typed-data encoder is unavailable.",
                signer_mode=getattr(settings, "withdraw_signer_mode", "local_private_key"),
                contract_address=contract_address or None,
            )
        if not contract_address or contract_address == "0x0000000000000000000000000000000000000000":
            return WithdrawSignerCapability(
                ticket_signing_enabled=False,
                code="WITHDRAW_CONTRACT_NOT_CONFIGURED",
                message="ROUTER_ADDRESS/SynapseCore address is not configured.",
                signer_mode=getattr(settings, "withdraw_signer_mode", "local_private_key"),
                contract_address=None,
            )
        return withdraw_signer_capability(settings).with_contract(contract_address)

    def _resolve_withdraw_deadline_sec(self) -> int:
        raw = getattr(
            settings, "provider_withdraw_deadline_sec", WITHDRAW_DEADLINE_SEC_DEFAULT
        )
        try:
            parsed = int(raw)
        except Exception:
            parsed = WITHDRAW_DEADLINE_SEC_DEFAULT
        if parsed < WITHDRAW_DEADLINE_SEC_MIN:
            return WITHDRAW_DEADLINE_SEC_MIN
        if parsed > WITHDRAW_DEADLINE_SEC_MAX:
            return WITHDRAW_DEADLINE_SEC_MAX
        return parsed

    def _require_withdraw_signer(self) -> WithdrawSignerConfig:
        return require_withdraw_signer_config(settings)

    def _withdraw_contract(self):
        web3_class = _web3_class()
        if web3_class is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "CHAIN_SDK_NOT_INSTALLED",
                    "message": "web3 dependency is required for withdrawal signing.",
                },
            )
        contract_address = normalize_wallet(settings.router_address)
        if (
            not contract_address
            or contract_address == "0x0000000000000000000000000000000000000000"
        ):
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "WITHDRAW_CONTRACT_NOT_CONFIGURED",
                    "message": "ROUTER_ADDRESS/SynapseCore address is not configured.",
                },
            )
        try:
            provider = web3_class(
                web3_class.HTTPProvider(
                    settings.rpc_url,
                    request_kwargs={"timeout": settings.rpc_request_timeout_sec},
                )
            )
            if not provider.is_connected():
                raise RuntimeError("rpc disconnected")
            contract = provider.eth.contract(
                address=web3_class.to_checksum_address(contract_address),
                abi=[
                    {
                        "inputs": [
                            {"internalType": "bytes32", "name": "ticketHash", "type": "bytes32"}
                        ],
                        "name": "isTicketConsumed",
                        "outputs": [
                            {"internalType": "bool", "name": "", "type": "bool"}
                        ],
                        "stateMutability": "view",
                        "type": "function",
                    }
                ],
            )
            return provider, contract
        except HTTPException:
            raise
        except Exception as exc:
            _log_chain_rpc_unavailable("withdraw_contract", exc)
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "CHAIN_RPC_UNAVAILABLE",
                    "message": "Unable to reach chain RPC for withdrawal ticket signing.",
                },
            )

    @staticmethod
    def _derive_withdraw_ticket_id(*, withdrawal_id: str) -> str:
        ticket_seed = f"synapse:withdraw:v2:claim:1:{withdrawal_id}".encode()
        return "0x" + hashlib.sha256(ticket_seed).hexdigest()

    def _build_withdraw_typed_data(
        self,
        *,
        owner_wallet: str,
        amount_wei: int,
        fee_wei: int,
        ticket_id: str,
        deadline: int,
        chain_id: int,
        verifying_contract: str,
    ) -> dict[str, Any]:
        web3_class = _web3_class()
        checksum_owner = (
            web3_class.to_checksum_address(owner_wallet) if web3_class is not None else owner_wallet
        )
        checksum_contract = (
            web3_class.to_checksum_address(verifying_contract)
            if web3_class is not None
            else verifying_contract
        )
        return {
            "types": {
                "EIP712Domain": [
                    {"name": "name", "type": "string"},
                    {"name": "version", "type": "string"},
                    {"name": "chainId", "type": "uint256"},
                    {"name": "verifyingContract", "type": "address"},
                ],
                "Withdraw": [
                    {"name": "user", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "fee", "type": "uint256"},
                    {"name": "ticketId", "type": "bytes32"},
                    {"name": "deadline", "type": "uint256"},
                ],
            },
            "primaryType": "Withdraw",
            "domain": {
                "name": "SynapseCore",
                "version": "1",
                "chainId": int(chain_id),
                "verifyingContract": checksum_contract,
            },
            "message": {
                "user": checksum_owner,
                "amount": int(amount_wei),
                "fee": int(fee_wei),
                "ticketId": str(ticket_id),
                "deadline": int(deadline),
            },
        }

    def _sign_withdraw_ticket(
        self, typed_data: dict[str, Any], signer_config: WithdrawSignerConfig
    ) -> tuple[str, str]:
        if Account is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "CHAIN_SDK_NOT_INSTALLED",
                    "message": "eth-account dependency is required for withdrawal signing.",
                },
            )
        if encode_typed_data is not None:
            signable = encode_typed_data(full_message=typed_data)
        elif encode_structured_data is not None:
            signable = encode_structured_data(primitive=typed_data)
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "CHAIN_SDK_NOT_INSTALLED",
                    "message": "eth-account typed-data encoder is unavailable.",
                },
            )
        signature, ticket_hash, _signer_address = sign_withdraw_ticket(
            signable=signable,
            config=signer_config,
        )
        return signature, ticket_hash

    def _resolve_withdraw_chain(self) -> int:
        provider, contract = self._withdraw_contract()
        try:
            chain_id = int(provider.eth.chain_id)
        except Exception as exc:
            _log_chain_rpc_unavailable("resolve_withdraw_chain", exc)
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "CHAIN_RPC_UNAVAILABLE",
                    "message": "Unable to query chainId for withdrawal.",
                },
            )
        return chain_id

    def _withdraw_ticket_consumed(self, ticket_hash: str) -> bool:
        _provider, contract = self._withdraw_contract()
        try:
            return bool(contract.functions.isTicketConsumed(ticket_hash).call())
        except Exception as exc:
            _log_chain_rpc_unavailable("withdraw_ticket_consumed", exc)
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "CHAIN_RPC_UNAVAILABLE",
                    "message": "Unable to query withdrawal ticket state.",
                },
            )

    def _read_vault_liquidity_amount_wei(self) -> int:
        token_address = normalize_wallet(settings.usdc_token_address)
        router_address = normalize_wallet(settings.router_address)
        if not token_address or not router_address:
            raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE")

        try:
            _provider, contract = self._withdraw_contract()
            web3 = getattr(contract, "w3", None)
            if web3 is None:
                raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE")
            token_contract = web3.eth.contract(
                address=web3.to_checksum_address(token_address),
                abi=[
                    {
                        "constant": True,
                        "inputs": [{"name": "account", "type": "address"}],
                        "name": "balanceOf",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "stateMutability": "view",
                        "type": "function",
                    }
                ],
            )
            return int(
                token_contract.functions.balanceOf(
                    web3.to_checksum_address(router_address)
                ).call()
            )
        except RuntimeError:
            raise
        except Exception as exc:
            _log_chain_rpc_unavailable("withdraw_vault_liquidity", exc)
            raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE") from exc

    def _assert_withdraw_vault_liquidity(self, amount_usdc: Decimal) -> None:
        amount_wei = usdc_decimal_to_atomic(amount_usdc, decimals=USDC_DECIMALS)
        vault_balance_wei = self._read_vault_liquidity_amount_wei()
        if vault_balance_wei < amount_wei:
            raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")

    def _latest_withdraw_rpc_block_timestamp(self) -> int:
        provider, _contract = self._withdraw_contract()
        try:
            latest_block = provider.eth.get_block("latest")
            return int(latest_block["timestamp"])
        except Exception as exc:
            _log_chain_rpc_unavailable("latest_withdraw_rpc_block_timestamp", exc)
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "CHAIN_RPC_UNAVAILABLE",
                    "message": "Unable to query latest chain block timestamp.",
                },
            )
