from __future__ import annotations

from types import SimpleNamespace

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException

from src.services.balance_mixins import withdraw_signing
from src.services.balance_mixins import withdraw_ticket_signers as signers
from src.services.balance_mixins.withdraw_signing import BalanceWithdrawSigningMixin
from src.services.balance_mixins.withdraw_ticket_signers import (
    WithdrawSignerConfig,
    withdraw_signer_address_from_config,
    withdraw_signer_capability,
    require_withdraw_signer_config,
    sign_withdraw_ticket,
)


def _der_integer(value: int) -> bytes:
    payload = value.to_bytes((value.bit_length() + 7) // 8 or 1, "big")
    if payload[0] & 0x80:
        payload = b"\x00" + payload
    return b"\x02" + bytes([len(payload)]) + payload


def _der_signature(r: int, s: int) -> bytes:
    payload = _der_integer(r) + _der_integer(s)
    return b"\x30" + bytes([len(payload)]) + payload


def test_local_private_key_signer_recovers_expected_address() -> None:
    account = Account.create("synapse-local-withdraw-signer")
    signable = encode_defunct(text="withdraw-ticket")

    signature, ticket_hash, signer_address = sign_withdraw_ticket(
        signable=signable,
        config=WithdrawSignerConfig(
            mode="local_private_key",
            private_key=account.key.hex(),
        ),
    )

    recovered = Account._recover_hash(  # noqa: SLF001  # because test must verify exact Ethereum recoverable signature behavior
        bytes.fromhex(ticket_hash.removeprefix("0x")),
        signature=bytes.fromhex(signature),
    )
    assert recovered.lower() == account.address.lower()
    assert signer_address == account.address.lower()


def test_gcp_kms_signer_uses_recovered_address_guard(monkeypatch) -> None:
    account = Account.create("synapse-gcp-kms-withdraw-signer")
    signable = encode_defunct(text="withdraw-ticket")
    digest = signers._signable_message_hash(signable)
    signed = Account._sign_hash(digest, account.key)  # noqa: SLF001  # because test needs deterministic DER signature fixture

    monkeypatch.setattr(
        signers,
        "_sign_digest_with_gcp_kms",
        lambda _key_name, _digest: _der_signature(signed.r, signed.s),
    )

    signature, ticket_hash, signer_address = sign_withdraw_ticket(
        signable=signable,
        config=WithdrawSignerConfig(
            mode="gcp_kms",
            signer_address=account.address.lower(),
            gcp_kms_key_name="projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1",
        ),
    )

    assert ticket_hash == "0x" + digest.hex()
    assert signer_address == account.address.lower()
    assert Account._recover_hash(digest, signature=bytes.fromhex(signature)).lower() == account.address.lower()  # noqa: SLF001  # because test must verify exact recovered signer


def test_kms_signer_fails_closed_on_address_mismatch(monkeypatch) -> None:
    account = Account.create("synapse-kms-address-mismatch")
    other = Account.create("synapse-kms-other")
    signable = encode_defunct(text="withdraw-ticket")
    digest = signers._signable_message_hash(signable)
    signed = Account._sign_hash(digest, account.key)  # noqa: SLF001  # because test needs deterministic DER signature fixture
    monkeypatch.setattr(
        signers,
        "_sign_digest_with_aws_kms",
        lambda _key_id, _digest: _der_signature(signed.r, signed.s),
    )

    with pytest.raises(HTTPException) as exc:
        sign_withdraw_ticket(
            signable=signable,
            config=WithdrawSignerConfig(
                mode="aws_kms",
                signer_address=other.address.lower(),
                aws_kms_key_id="alias/synapse-withdraw-signer",
            ),
        )

    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_ADDRESS_MISMATCH"


def test_require_kms_config_needs_key_and_signer(monkeypatch) -> None:
    class _Settings:
        withdraw_signer_mode = "gcp_kms"
        private_key = ""
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = ""

    with pytest.raises(HTTPException) as exc:
        require_withdraw_signer_config(_Settings())

    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_NOT_CONFIGURED"


def test_require_kms_config_accepts_gcp_and_rejects_partial_aws() -> None:
    class _GcpSettings:
        withdraw_signer_mode = "gcp_kms"
        private_key = ""
        withdraw_signer_address = "0x000000000000000000000000000000000000dEaD"
        withdraw_signer_gcp_kms_key_name = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1"
        withdraw_signer_aws_kms_key_id = ""

    assert require_withdraw_signer_config(_GcpSettings()).mode == "gcp_kms"

    class _AwsSettings:
        withdraw_signer_mode = "aws_kms"
        private_key = ""
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = "alias/synapse-withdraw-signer"

    with pytest.raises(HTTPException) as exc:
        require_withdraw_signer_config(_AwsSettings())
    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_NOT_CONFIGURED"


def test_require_signer_rejects_unsupported_mode() -> None:
    class _Settings:
        withdraw_signer_mode = "plaintext_hsm"
        private_key = ""
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = ""

    with pytest.raises(HTTPException) as exc:
        require_withdraw_signer_config(_Settings())
    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_MODE_UNSUPPORTED"


def test_kms_config_does_not_fallback_to_legacy_staging_address(monkeypatch) -> None:
    monkeypatch.setenv("STAGING_WITHDRAW_SIGNER_ADDRESS", Account.create().address)

    class _Settings:
        environment = "staging"
        withdraw_signer_mode = "gcp_kms"
        private_key = ""
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1"
        withdraw_signer_aws_kms_key_id = ""

    with pytest.raises(HTTPException) as exc:
        require_withdraw_signer_config(_Settings())

    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_NOT_CONFIGURED"


@pytest.mark.parametrize("environment", ["prod", "production"])
def test_local_private_key_mode_is_forbidden_in_production(environment: str) -> None:
    class _Settings:
        withdraw_signer_mode = "local_private_key"
        private_key = "0x" + "11" * 32
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = ""

    _Settings.environment = environment

    with pytest.raises(HTTPException) as exc:
        require_withdraw_signer_config(_Settings())

    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_LOCAL_PRIVATE_KEY_FORBIDDEN_IN_PROD"


@pytest.mark.parametrize("environment", ["local", "staging"])
def test_local_private_key_mode_remains_allowed_outside_production(environment: str) -> None:
    class _Settings:
        withdraw_signer_mode = "local_private_key"
        private_key = "0x" + "11" * 32
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = ""

    _Settings.environment = environment

    config = require_withdraw_signer_config(_Settings())

    assert config.mode == "local_private_key"


def test_setting_env_fallback_and_aws_config(monkeypatch) -> None:
    monkeypatch.setenv("WITHDRAW_SIGNER_MODE", "aws_kms")
    monkeypatch.setenv("WITHDRAW_SIGNER_ADDRESS", "0x000000000000000000000000000000000000dEaD")
    monkeypatch.setenv("WITHDRAW_SIGNER_AWS_KMS_KEY_ID", "alias/synapse-withdraw-signer")

    class _Settings:
        private_key = ""

    config = require_withdraw_signer_config(_Settings())

    assert config.mode == "aws_kms"
    assert config.signer_address == "0x000000000000000000000000000000000000dead"
    assert config.aws_kms_key_id == "alias/synapse-withdraw-signer"


def test_unsupported_signer_mode_fails_closed() -> None:
    with pytest.raises(HTTPException) as exc:
        sign_withdraw_ticket(
            signable=encode_defunct(text="withdraw-ticket"),
            config=WithdrawSignerConfig(mode="filesystem"),
        )

    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_MODE_UNSUPPORTED"


def test_capability_reports_config_error_and_contract() -> None:
    class _Settings:
        withdraw_signer_mode = "gcp_kms"
        private_key = ""
        withdraw_signer_address = "0x000000000000000000000000000000000000dEaD"
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = ""

    capability = withdraw_signer_capability(_Settings()).with_contract(
        "0x000000000000000000000000000000000000c0Fe"
    )

    assert capability.ticket_signing_enabled is False
    assert capability.signer_address == "0x000000000000000000000000000000000000dead"
    assert capability.contract_address == "0x000000000000000000000000000000000000c0Fe"
    assert capability.to_response_dict()["code"] == "WITHDRAW_SIGNER_NOT_CONFIGURED"


def test_capability_resolves_local_signer_address() -> None:
    account = Account.create("synapse-capability-local")

    class _Settings:
        environment = "local"
        withdraw_signer_mode = "local_private_key"
        private_key = account.key.hex()
        withdraw_signer_address = ""
        withdraw_signer_gcp_kms_key_name = ""
        withdraw_signer_aws_kms_key_id = ""

    capability = withdraw_signer_capability(_Settings())

    assert capability.ticket_signing_enabled is True
    assert capability.signer_address == account.address.lower()
    assert withdraw_signer_address_from_config(
        WithdrawSignerConfig(mode="local_private_key", private_key=account.key.hex())
    ) == account.address.lower()
    assert withdraw_signer_address_from_config(
        WithdrawSignerConfig(
            mode="gcp_kms",
            signer_address="0x000000000000000000000000000000000000dEaD",
        )
    ) == "0x000000000000000000000000000000000000dEaD"
    assert withdraw_signer_address_from_config(WithdrawSignerConfig(mode="aws_kms")) == ""


def test_chain_dependency_failures_are_explicit(monkeypatch) -> None:
    signable = encode_defunct(text="withdraw-ticket")
    monkeypatch.setattr(signers, "EthAccount", None)

    with pytest.raises(HTTPException) as exc:
        signers._sign_with_local_private_key(signable, "0x" + "11" * 32)
    assert exc.value.detail["code"] == "CHAIN_SDK_NOT_INSTALLED"
    assert signers._local_private_key_address("not-a-key") == ""

    monkeypatch.setattr(signers, "eth_keccak", None)
    with pytest.raises(HTTPException) as hash_exc:
        signers._signable_message_hash(signable)
    assert hash_exc.value.detail["code"] == "CHAIN_SDK_NOT_INSTALLED"

    with pytest.raises(HTTPException) as recover_exc:
        signers._recoverable_signature_from_der(
            der_signature=_der_signature(1, 2),
            digest=b"\x01" * 32,
            expected_signer="0x000000000000000000000000000000000000dEaD",
        )
    assert recover_exc.value.detail["code"] == "CHAIN_SDK_NOT_INSTALLED"


def test_recover_candidate_exceptions_are_ignored_then_fail(monkeypatch) -> None:
    class _BrokenAccount:
        @staticmethod
        def _recover_hash(digest, signature):
            raise ValueError

    monkeypatch.setattr(signers, "EthAccount", _BrokenAccount)

    with pytest.raises(HTTPException) as exc:
        signers._recoverable_signature_from_der(
            der_signature=_der_signature(1, 2),
            digest=b"\x01" * 32,
            expected_signer="0x000000000000000000000000000000000000dEaD",
        )

    assert exc.value.detail["code"] == "WITHDRAW_SIGNER_ADDRESS_MISMATCH"


def test_der_parser_handles_long_form_and_rejects_invalid_shapes() -> None:
    payload = _der_integer(1 << 760) + _der_integer(2)
    long_form = b"\x30\x81" + bytes([len(payload)]) + payload
    r, s = signers._decode_ecdsa_der_signature(long_form)
    assert r == 1 << 760
    assert s == 2

    invalid_samples = [
        b"\x31\x06\x02\x01\x01\x02\x01\x02",
        b"\x30\x00",
        b"\x30\x80\x02\x01\x01\x02\x01\x02",
        b"\x30\x83\x00\x00\x06\x02\x01\x01\x02\x01\x02",
        b"\x30\x07\x02\x01\x01\x02\x01\x02",
        b"\x30\x06\x03\x01\x01\x02\x01\x02",
        b"\x30\x06\x02\x00\x02\x01\x02",
        b"\x30\x06\x02\x01\x00\x02\x01\x02",
        b"\x30\x06\x02\x05\x01\x02\x01\x02",
    ]
    for sample in invalid_samples:
        with pytest.raises(HTTPException) as exc:
            signers._decode_ecdsa_der_signature(sample)
        assert exc.value.detail["code"] == "WITHDRAW_KMS_SIGNATURE_INVALID"


def test_low_s_normalization_and_missing_curve_constant(monkeypatch) -> None:
    assert signers._normalize_low_s(1) == 1
    assert signers._normalize_low_s(signers.SECPK1_N - 1) == 1

    monkeypatch.setattr(signers, "SECPK1_N", None)
    with pytest.raises(HTTPException) as exc:
        signers._normalize_low_s(1)
    assert exc.value.detail["code"] == "CHAIN_SDK_NOT_INSTALLED"


def test_gcp_kms_client_success_failure_and_missing_dependency(monkeypatch) -> None:
    class _Response:
        signature = b"der-signature"

    class _Client:
        def asymmetric_sign(self, request):
            assert request["name"] == "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1"
            assert request["digest"]["sha256"] == b"\x01" * 32
            return _Response()

    class _KmsModule:
        KeyManagementServiceClient = _Client

    monkeypatch.setattr(signers, "gcp_kms_v1", _KmsModule)
    assert signers._sign_digest_with_gcp_kms(
        "projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1",
        b"\x01" * 32,
    ) == b"der-signature"

    class _FailingClient:
        def asymmetric_sign(self, request):
            raise RuntimeError

    class _HttpExceptionClient:
        def asymmetric_sign(self, request):
            raise HTTPException(status_code=418, detail={"code": "TEAPOT"})

    class _FailingKmsModule:
        KeyManagementServiceClient = _FailingClient

    monkeypatch.setattr(signers, "gcp_kms_v1", _FailingKmsModule)
    with pytest.raises(HTTPException) as unavailable:
        signers._sign_digest_with_gcp_kms("key", b"\x02" * 32)
    assert unavailable.value.detail["code"] == "WITHDRAW_KMS_SIGNING_UNAVAILABLE"

    class _HttpExceptionKmsModule:
        KeyManagementServiceClient = _HttpExceptionClient

    monkeypatch.setattr(signers, "gcp_kms_v1", _HttpExceptionKmsModule)
    with pytest.raises(HTTPException) as passthrough:
        signers._sign_digest_with_gcp_kms("key", b"\x02" * 32)
    assert passthrough.value.detail["code"] == "TEAPOT"

    monkeypatch.setattr(signers, "gcp_kms_v1", None)
    with pytest.raises(HTTPException) as missing:
        signers._sign_digest_with_gcp_kms("key", b"\x02" * 32)
    assert missing.value.detail["code"] == "WITHDRAW_KMS_CLIENT_NOT_INSTALLED"


def test_aws_kms_client_success_failure_and_missing_dependency(monkeypatch) -> None:
    class _Client:
        def sign(self, **kwargs):
            assert kwargs == {
                "KeyId": "alias/synapse-withdraw-signer",
                "Message": b"\x03" * 32,
                "MessageType": "DIGEST",
                "SigningAlgorithm": "ECDSA_SHA_256",
            }
            return {"Signature": b"aws-der-signature"}

    class _Boto3:
        @staticmethod
        def client(service_name: str):
            assert service_name == "kms"
            return _Client()

    monkeypatch.setattr(signers, "aws_boto3", _Boto3)
    assert signers._sign_digest_with_aws_kms(
        "alias/synapse-withdraw-signer", b"\x03" * 32
    ) == b"aws-der-signature"

    class _FailingBoto3:
        @staticmethod
        def client(service_name: str):
            raise RuntimeError

    class _HttpExceptionBoto3:
        @staticmethod
        def client(service_name: str):
            raise HTTPException(status_code=418, detail={"code": "TEAPOT"})

    monkeypatch.setattr(signers, "aws_boto3", _FailingBoto3)
    with pytest.raises(HTTPException) as unavailable:
        signers._sign_digest_with_aws_kms("key", b"\x04" * 32)
    assert unavailable.value.detail["code"] == "WITHDRAW_KMS_SIGNING_UNAVAILABLE"

    monkeypatch.setattr(signers, "aws_boto3", _HttpExceptionBoto3)
    with pytest.raises(HTTPException) as passthrough:
        signers._sign_digest_with_aws_kms("key", b"\x04" * 32)
    assert passthrough.value.detail["code"] == "TEAPOT"

    monkeypatch.setattr(signers, "aws_boto3", None)
    with pytest.raises(HTTPException) as missing:
        signers._sign_digest_with_aws_kms("key", b"\x04" * 32)
    assert missing.value.detail["code"] == "WITHDRAW_KMS_CLIENT_NOT_INSTALLED"


def test_withdraw_signing_capability_reports_missing_runtime_dependencies(monkeypatch) -> None:
    monkeypatch.setattr(
        withdraw_signing,
        "settings",
        SimpleNamespace(
            router_address="0x000000000000000000000000000000000000c0Fe",
            withdraw_signer_mode="local_private_key",
        ),
    )
    monkeypatch.setattr(withdraw_signing, "_web3_class", lambda: None)

    capability = BalanceWithdrawSigningMixin().provider_withdraw_capability()

    assert capability.code == "CHAIN_SDK_NOT_INSTALLED"


def test_withdraw_signing_capability_reports_missing_encoder(monkeypatch) -> None:
    monkeypatch.setattr(
        withdraw_signing,
        "settings",
        SimpleNamespace(
            router_address="0x000000000000000000000000000000000000c0Fe",
            withdraw_signer_mode="local_private_key",
        ),
    )
    monkeypatch.setattr(withdraw_signing, "_web3_class", lambda: object)
    monkeypatch.setattr(withdraw_signing, "Account", object)
    monkeypatch.setattr(withdraw_signing, "encode_typed_data", None)
    monkeypatch.setattr(withdraw_signing, "encode_structured_data", None)

    capability = BalanceWithdrawSigningMixin().provider_withdraw_capability()

    assert capability.code == "CHAIN_SDK_NOT_INSTALLED"
    assert "typed-data encoder" in capability.message


def test_withdraw_signing_capability_reports_missing_contract(monkeypatch) -> None:
    monkeypatch.setattr(
        withdraw_signing,
        "settings",
        SimpleNamespace(
            router_address="0x0000000000000000000000000000000000000000",
            withdraw_signer_mode="local_private_key",
        ),
    )
    monkeypatch.setattr(withdraw_signing, "_web3_class", lambda: object)
    monkeypatch.setattr(withdraw_signing, "Account", object)
    monkeypatch.setattr(withdraw_signing, "encode_typed_data", object())
    monkeypatch.setattr(withdraw_signing, "encode_structured_data", None)

    capability = BalanceWithdrawSigningMixin().provider_withdraw_capability()

    assert capability.code == "WITHDRAW_CONTRACT_NOT_CONFIGURED"


def test_withdraw_signing_delegates_to_configured_signer(monkeypatch) -> None:
    account = Account.create("synapse-signing-mixin")
    signer_config = WithdrawSignerConfig(
        mode="local_private_key",
        private_key=account.key.hex(),
    )
    signable = encode_defunct(text="withdraw-ticket")

    monkeypatch.setattr(
        withdraw_signing,
        "settings",
        SimpleNamespace(
            environment="local",
            private_key=account.key.hex(),
            withdraw_signer_mode="local_private_key",
            withdraw_signer_address="",
            withdraw_signer_gcp_kms_key_name="",
            withdraw_signer_aws_kms_key_id="",
        ),
    )
    monkeypatch.setattr(withdraw_signing, "encode_typed_data", lambda full_message: signable)
    monkeypatch.setattr(withdraw_signing, "encode_structured_data", None)

    mixin = BalanceWithdrawSigningMixin()
    assert mixin._require_withdraw_signer() == signer_config

    signature, ticket_hash = mixin._sign_withdraw_ticket(
        {"message": "typed-data"},
        signer_config,
    )

    assert signature
    assert ticket_hash.startswith("0x")
