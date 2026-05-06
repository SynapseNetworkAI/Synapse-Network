"""Withdrawal policy settings helpers."""
from __future__ import annotations

from src.core.config_loaders import _canonical_environment_name, _env_bool, _env_int


def _withdraw_maturity_enforcement_default(environment: str) -> bool:
    return _canonical_environment_name(environment) != "local"


def _withdraw_maturity_settings(environment: str) -> tuple[int, bool, int, bool]:
    return (
        max(0, _env_int("CONSUMER_WITHDRAW_MATURITY_SECONDS", 604800)),
        _env_bool(
            "CONSUMER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED",
            _withdraw_maturity_enforcement_default(environment),
        ),
        max(0, _env_int("PROVIDER_WITHDRAW_MATURITY_SECONDS", 604800)),
        _env_bool(
            "PROVIDER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED",
            _withdraw_maturity_enforcement_default(environment),
        ),
    )


def _validate_withdraw_maturity_enforcement(
    environment: str,
    consumer_enabled: bool,
    provider_enabled: bool,
) -> None:
    if _canonical_environment_name(environment) == "prod" and (
        not consumer_enabled or not provider_enabled
    ):
        raise RuntimeError("WITHDRAW_MATURITY_ENFORCEMENT_REQUIRED_IN_PROD")
