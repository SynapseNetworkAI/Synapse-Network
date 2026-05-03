from __future__ import annotations

import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import HTTPException

from src.core.common import normalize_wallet

logger = logging.getLogger(__name__)

EthAccount: Any | None = None
SECPK1_N: int | None = None
eth_keccak: Callable[[bytes], bytes] | None = None
gcp_kms_v1: Any | None = None
aws_boto3: Any | None = None

try:
    from eth_account import Account as _EthAccount  # type: ignore[import-not-found]  # because runtime image installs optional chain SDK

    EthAccount = _EthAccount
except Exception:
    logger.debug("withdraw.signer.eth_account_unavailable", exc_info=True)

try:
    from eth_keys.constants import SECPK1_N as _SECPK1_N  # type: ignore[import-not-found]  # because runtime image installs optional chain SDK

    SECPK1_N = int(_SECPK1_N)
except Exception:
    logger.debug("withdraw.signer.eth_keys_unavailable", exc_info=True)

try:
    from eth_utils import keccak as _eth_keccak  # type: ignore[import-not-found]  # because runtime image installs optional chain SDK

    eth_keccak = _eth_keccak
except Exception:
    logger.debug("withdraw.signer.eth_utils_unavailable", exc_info=True)

try:
    from google.cloud import kms_v1 as _gcp_kms_v1  # type: ignore[import-not-found]  # because KMS signer dependency is optional outside gcp_kms mode

    gcp_kms_v1 = _gcp_kms_v1
except Exception:
    logger.debug("withdraw.signer.gcp_kms_unavailable", exc_info=True)

try:
    import boto3 as _aws_boto3  # type: ignore[import-not-found]  # because AWS signer dependency is optional outside aws_kms mode

    aws_boto3 = _aws_boto3
except Exception:
    logger.debug("withdraw.signer.aws_kms_unavailable", exc_info=True)

DER_MIN_SIGNATURE_BYTES = 8
DER_SEQUENCE_TAG = 0x30
DER_INTEGER_TAG = 0x02
DER_LONG_LENGTH_FLAG = 0x80
DER_LONG_LENGTH_MASK = 0x7F
DER_MAX_LENGTH_BYTES = 2
PRODUCTION_ENVIRONMENTS = {"prod", "production"}


def _setting_or_env(settings: Any, attribute: str, env_name: str) -> str:
    value = getattr(settings, attribute, None)
    if value is not None:
        return str(value)
    return os.getenv(env_name, "")


def _is_production_environment(settings: Any) -> bool:
    environment = str(_setting_or_env(settings, "environment", "ENVIRONMENT") or "local")
    return environment.strip().lower() in PRODUCTION_ENVIRONMENTS


class SignableMessage(Protocol):
    version: bytes
    header: bytes
    body: bytes


@dataclass(frozen=True)
class WithdrawSignerConfig:
    mode: str
    private_key: str = ""
    signer_address: str = ""
    gcp_kms_key_name: str = ""
    aws_kms_key_id: str = ""


@dataclass(frozen=True)
class WithdrawSignerCapability:
    ticket_signing_enabled: bool
    code: str | None
    message: str
    signer_mode: str
    signer_address: str | None = None
    contract_address: str | None = None

    def with_contract(self, contract_address: str | None) -> "WithdrawSignerCapability":
        return WithdrawSignerCapability(
            ticket_signing_enabled=self.ticket_signing_enabled,
            code=self.code,
            message=self.message,
            signer_mode=self.signer_mode,
            signer_address=self.signer_address,
            contract_address=contract_address,
        )

    def to_response_dict(self) -> dict[str, Any]:
        return {
            "ticketSigningEnabled": self.ticket_signing_enabled,
            "code": self.code,
            "message": self.message,
            "signerMode": self.signer_mode,
            "signerAddress": self.signer_address,
            "contractAddress": self.contract_address,
        }


def withdraw_signer_config(settings: Any) -> WithdrawSignerConfig:
    mode = str(
        _setting_or_env(settings, "withdraw_signer_mode", "WITHDRAW_SIGNER_MODE")
        or "local_private_key"
    ).strip().lower()
    return WithdrawSignerConfig(
        mode=mode,
        private_key=str(getattr(settings, "private_key", "") or "").strip(),
        signer_address=normalize_wallet(
            str(
                _setting_or_env(settings, "withdraw_signer_address", "WITHDRAW_SIGNER_ADDRESS")
            ).strip()
        ),
        gcp_kms_key_name=str(
            _setting_or_env(
                settings,
                "withdraw_signer_gcp_kms_key_name",
                "WITHDRAW_SIGNER_GCP_KMS_KEY_NAME",
            )
            or ""
        ).strip(),
        aws_kms_key_id=str(
            _setting_or_env(
                settings,
                "withdraw_signer_aws_kms_key_id",
                "WITHDRAW_SIGNER_AWS_KMS_KEY_ID",
            )
            or ""
        ).strip(),
    )


def require_withdraw_signer_config(settings: Any) -> WithdrawSignerConfig:
    config = withdraw_signer_config(settings)
    if config.mode == "local_private_key":
        if _is_production_environment(settings):
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "WITHDRAW_SIGNER_LOCAL_PRIVATE_KEY_FORBIDDEN_IN_PROD",
                    "message": (
                        "Production withdrawal ticket signing must use gcp_kms "
                        "or aws_kms; local_private_key is only allowed for local."
                    ),
                },
            )
        if not config.private_key:
            _raise_not_configured(
                "gateway withdraw signer is not configured; PRIVATE_KEY is required "
                "for local_private_key ticket signing."
            )
        return config
    if config.mode == "gcp_kms":
        if not config.gcp_kms_key_name or not config.signer_address:
            _raise_not_configured(
                "WITHDRAW_SIGNER_GCP_KMS_KEY_NAME and WITHDRAW_SIGNER_ADDRESS are required for gcp_kms signing."
            )
        return config
    if config.mode == "aws_kms":
        if not config.aws_kms_key_id or not config.signer_address:
            _raise_not_configured(
                "WITHDRAW_SIGNER_AWS_KMS_KEY_ID and WITHDRAW_SIGNER_ADDRESS are required for aws_kms signing."
            )
        return config
    raise HTTPException(
        status_code=500,
        detail={
            "code": "WITHDRAW_SIGNER_MODE_UNSUPPORTED",
            "message": "WITHDRAW_SIGNER_MODE must be local_private_key, gcp_kms, or aws_kms.",
        },
    )


def withdraw_signer_capability(settings: Any) -> WithdrawSignerCapability:
    try:
        config = require_withdraw_signer_config(settings)
    except HTTPException as exc:
        detail: dict[str, Any] = exc.detail if isinstance(exc.detail, dict) else {}
        return WithdrawSignerCapability(
            ticket_signing_enabled=False,
            code=detail.get("code") or "WITHDRAW_SIGNER_NOT_CONFIGURED",
            message=detail.get("message")
            or "Gateway withdraw signer is not configured.",
            signer_mode=str(
                _setting_or_env(settings, "withdraw_signer_mode", "WITHDRAW_SIGNER_MODE")
                or "local_private_key"
            ),
            signer_address=normalize_wallet(
                str(
                    _setting_or_env(
                        settings,
                        "withdraw_signer_address",
                        "WITHDRAW_SIGNER_ADDRESS",
                    )
                )
            )
            or None,
        )
    signer_address = config.signer_address
    if config.mode == "local_private_key":
        signer_address = _local_private_key_address(config.private_key)
    return WithdrawSignerCapability(
        ticket_signing_enabled=True,
        code=None,
        message="Gateway withdraw signer is ready.",
        signer_mode=config.mode,
        signer_address=signer_address or None,
    )


def withdraw_signer_address_from_config(config: WithdrawSignerConfig) -> str:
    if config.signer_address:
        return config.signer_address
    if config.mode == "local_private_key":
        return _local_private_key_address(config.private_key)
    return ""


def sign_withdraw_ticket(
    *,
    signable: SignableMessage,
    config: WithdrawSignerConfig,
) -> tuple[str, str, str]:
    if config.mode == "local_private_key":
        return _sign_with_local_private_key(signable, config.private_key)
    digest = _signable_message_hash(signable)
    if config.mode == "gcp_kms":
        der_signature = _sign_digest_with_gcp_kms(config.gcp_kms_key_name, digest)
    elif config.mode == "aws_kms":
        der_signature = _sign_digest_with_aws_kms(config.aws_kms_key_id, digest)
    else:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "WITHDRAW_SIGNER_MODE_UNSUPPORTED",
                "message": "WITHDRAW_SIGNER_MODE must be local_private_key, gcp_kms, or aws_kms.",
            },
        )
    signature = _recoverable_signature_from_der(
        der_signature=der_signature,
        digest=digest,
        expected_signer=config.signer_address,
    )
    return signature, "0x" + digest.hex(), config.signer_address


def _sign_with_local_private_key(
    signable: SignableMessage, private_key: str
) -> tuple[str, str, str]:
    if EthAccount is None:
        raise _chain_sdk_error()
    signed = EthAccount.sign_message(signable, private_key=private_key)
    signer_address = normalize_wallet(EthAccount.from_key(private_key).address)
    return str(signed.signature.hex()), "0x" + bytes(signed.message_hash).hex(), signer_address


def _local_private_key_address(private_key: str) -> str:
    if EthAccount is None:
        return ""
    try:
        return normalize_wallet(EthAccount.from_key(private_key).address)
    except Exception:
        return ""


def _signable_message_hash(signable: SignableMessage) -> bytes:
    if eth_keccak is None:
        raise _chain_sdk_error()
    return bytes(eth_keccak(b"\x19" + signable.version + signable.header + signable.body))


def _recoverable_signature_from_der(
    *, der_signature: bytes, digest: bytes, expected_signer: str
) -> str:
    r, s = _decode_ecdsa_der_signature(der_signature)
    s = _normalize_low_s(s)
    expected = normalize_wallet(expected_signer)
    if EthAccount is None:
        raise _chain_sdk_error()
    for recovery_id in (27, 28):
        signature = r.to_bytes(32, "big") + s.to_bytes(32, "big") + bytes([recovery_id])
        try:
            recovered = normalize_wallet(
                EthAccount._recover_hash(digest, signature=signature)  # noqa: SLF001  # because eth-account exposes no public recover-hash helper
            )
        except Exception:
            logger.debug("withdraw.kms.recover_candidate_failed", exc_info=True)
            continue
        if recovered == expected:
            return signature.hex()
    raise HTTPException(
        status_code=500,
        detail={
            "code": "WITHDRAW_SIGNER_ADDRESS_MISMATCH",
            "message": "KMS withdrawal signature did not recover to the configured platform signer.",
        },
    )


def _decode_ecdsa_der_signature(der_signature: bytes) -> tuple[int, int]:
    if (
        len(der_signature) < DER_MIN_SIGNATURE_BYTES
        or der_signature[0] != DER_SEQUENCE_TAG
    ):
        raise _invalid_kms_signature()
    cursor = 2
    if der_signature[1] & DER_LONG_LENGTH_FLAG:
        length_bytes = der_signature[1] & DER_LONG_LENGTH_MASK
        if length_bytes == 0 or length_bytes > DER_MAX_LENGTH_BYTES:
            raise _invalid_kms_signature()
        total_length = int.from_bytes(der_signature[cursor : cursor + length_bytes], "big")
        cursor += length_bytes
    else:
        total_length = der_signature[1]
    if total_length != len(der_signature) - cursor:
        raise _invalid_kms_signature()
    r, cursor = _read_der_integer(der_signature, cursor)
    s, cursor = _read_der_integer(der_signature, cursor)
    if cursor != len(der_signature) or r <= 0 or s <= 0:
        raise _invalid_kms_signature()
    return r, s


def _read_der_integer(der_bytes: bytes, cursor: int) -> tuple[int, int]:
    if cursor + 2 > len(der_bytes) or der_bytes[cursor] != DER_INTEGER_TAG:
        raise _invalid_kms_signature()
    length = der_bytes[cursor + 1]
    start = cursor + 2
    end = start + length
    if length == 0 or end > len(der_bytes):
        raise _invalid_kms_signature()
    return int.from_bytes(der_bytes[start:end], "big"), end


def _normalize_low_s(s: int) -> int:
    if SECPK1_N is None:
        raise _chain_sdk_error()
    half_order = SECPK1_N // 2
    return SECPK1_N - s if s > half_order else s


def _sign_digest_with_gcp_kms(key_name: str, digest: bytes) -> bytes:
    if gcp_kms_v1 is None:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "WITHDRAW_KMS_CLIENT_NOT_INSTALLED",
                "message": "google-cloud-kms is required for gcp_kms withdrawal signing.",
            },
        )
    try:
        client = gcp_kms_v1.KeyManagementServiceClient()
        response = client.asymmetric_sign(
            request={"name": key_name, "digest": {"sha256": digest}}
        )
        return bytes(response.signature)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "WITHDRAW_KMS_SIGNING_UNAVAILABLE",
                "message": "GCP KMS withdrawal signer is unavailable.",
            },
        ) from exc


def _sign_digest_with_aws_kms(key_id: str, digest: bytes) -> bytes:
    if aws_boto3 is None:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "WITHDRAW_KMS_CLIENT_NOT_INSTALLED",
                "message": "boto3 is required for aws_kms withdrawal signing.",
            },
        )
    try:
        client = aws_boto3.client("kms")
        response = client.sign(
            KeyId=key_id,
            Message=digest,
            MessageType="DIGEST",
            SigningAlgorithm="ECDSA_SHA_256",
        )
        return bytes(response["Signature"])
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "WITHDRAW_KMS_SIGNING_UNAVAILABLE",
                "message": "AWS KMS withdrawal signer is unavailable.",
            },
        ) from exc


def _raise_not_configured(message: str) -> None:
    raise HTTPException(
        status_code=500,
        detail={"code": "WITHDRAW_SIGNER_NOT_CONFIGURED", "message": message},
    )


def _chain_sdk_error() -> HTTPException:
    return HTTPException(
        status_code=500,
        detail={
            "code": "CHAIN_SDK_NOT_INSTALLED",
            "message": "eth-account typed-data signing dependencies are unavailable.",
        },
    )


def _invalid_kms_signature() -> HTTPException:
    return HTTPException(
        status_code=500,
        detail={
            "code": "WITHDRAW_KMS_SIGNATURE_INVALID",
            "message": "KMS returned an invalid ECDSA signature.",
        },
    )
