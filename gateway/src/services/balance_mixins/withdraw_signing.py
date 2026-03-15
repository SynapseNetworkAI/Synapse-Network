from typing import Any, Dict

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings

try:
    from web3 import Web3  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    Web3 = None  # type: ignore[assignment]

try:
    from eth_account import Account  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    Account = None  # type: ignore[assignment]

try:
    from eth_account.messages import encode_typed_data  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    encode_typed_data = None

try:
    from eth_account.messages import encode_structured_data  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    encode_structured_data = None

WITHDRAW_DEADLINE_SEC_MIN = 60
WITHDRAW_DEADLINE_SEC_MAX = 86400
WITHDRAW_DEADLINE_SEC_DEFAULT = 900
USDC_DECIMALS = 18


class BalanceWithdrawSigningMixin:
    def _resolve_withdraw_deadline_sec(self) -> int:
        raw = getattr(settings, "provider_withdraw_deadline_sec", WITHDRAW_DEADLINE_SEC_DEFAULT)
        try:
            parsed = int(raw)
        except Exception:
            parsed = WITHDRAW_DEADLINE_SEC_DEFAULT
        if parsed < WITHDRAW_DEADLINE_SEC_MIN:
            return WITHDRAW_DEADLINE_SEC_MIN
        if parsed > WITHDRAW_DEADLINE_SEC_MAX:
            return WITHDRAW_DEADLINE_SEC_MAX
        return parsed

    def _require_withdraw_signer(self) -> str:
        private_key = str(getattr(settings, "private_key", "") or "").strip()
        if not private_key:
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "WITHDRAW_SIGNER_NOT_CONFIGURED",
                    "message": "PRIVATE_KEY is required to sign withdrawal tickets.",
                },
            )
        return private_key

    def _withdraw_contract(self):
        if Web3 is None:
            raise HTTPException(
                status_code=500,
                detail={"code": "CHAIN_SDK_NOT_INSTALLED", "message": "web3 dependency is required for withdrawal signing."},
            )
        contract_address = normalize_wallet(settings.router_address)
        if not contract_address or contract_address == "0x0000000000000000000000000000000000000000":
            raise HTTPException(
                status_code=500,
                detail={"code": "WITHDRAW_CONTRACT_NOT_CONFIGURED", "message": "ROUTER_ADDRESS/SynapseCore address is not configured."},
            )
        try:
            provider = Web3(Web3.HTTPProvider(settings.rpc_url))
            if not provider.is_connected():
                raise RuntimeError("rpc disconnected")
            contract = provider.eth.contract(
                address=Web3.to_checksum_address(contract_address),
                abi=[
                    {
                        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
                        "name": "userNonces",
                        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
                        "stateMutability": "view",
                        "type": "function",
                    }
                ],
            )
            return provider, contract
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=503,
                detail={"code": "CHAIN_RPC_UNAVAILABLE", "message": "Unable to reach chain RPC for withdrawal nonce."},
            )

    def _build_withdraw_typed_data(
        self,
        *,
        owner_wallet: str,
        amount_wei: int,
        fee_wei: int,
        nonce: int,
        deadline: int,
        chain_id: int,
        verifying_contract: str,
    ) -> Dict[str, Any]:
        checksum_owner = Web3.to_checksum_address(owner_wallet) if Web3 is not None else owner_wallet
        checksum_contract = (
            Web3.to_checksum_address(verifying_contract) if Web3 is not None else verifying_contract
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
                    {"name": "nonce", "type": "uint256"},
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
                "nonce": int(nonce),
                "deadline": int(deadline),
            },
        }

    def _sign_withdraw_ticket(self, typed_data: Dict[str, Any], private_key: str) -> str:
        if Account is None:
            raise HTTPException(
                status_code=500,
                detail={"code": "CHAIN_SDK_NOT_INSTALLED", "message": "eth-account dependency is required for withdrawal signing."},
            )
        if encode_typed_data is not None:
            signable = encode_typed_data(full_message=typed_data)
        elif encode_structured_data is not None:
            signable = encode_structured_data(primitive=typed_data)
        else:
            raise HTTPException(
                status_code=500,
                detail={"code": "CHAIN_SDK_NOT_INSTALLED", "message": "eth-account typed-data encoder is unavailable."},
            )
        signed = Account.sign_message(signable, private_key=private_key)
        return str(signed.signature.hex())

    def _resolve_withdraw_nonce_and_chain(self, owner: str) -> tuple[int, int]:
        provider, contract = self._withdraw_contract()
        owner_for_chain = Web3.to_checksum_address(owner) if Web3 is not None else owner
        try:
            nonce = int(contract.functions.userNonces(owner_for_chain).call())
            chain_id = int(provider.eth.chain_id)
        except Exception:
            raise HTTPException(
                status_code=503,
                detail={"code": "CHAIN_RPC_UNAVAILABLE", "message": "Unable to query nonce/chainId for withdrawal."},
            )
        return nonce, chain_id
