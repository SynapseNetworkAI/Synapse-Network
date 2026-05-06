import os

import pytest

from src.core import config
from src.core.config_withdrawal import _withdraw_maturity_enforcement_default


def test_resolve_env_file_path_prefers_gateway_root_for_local_template() -> None:
    resolved = config._resolve_env_file_path(".env.local.example")

    assert resolved.endswith("/gateway/.env.local.example")


def test_gateway_and_repo_root_dirs_are_distinct() -> None:
    gateway_root = config._gateway_root_dir()
    repo_root = config._repo_root_dir()

    assert gateway_root.endswith("/gateway")
    assert os.path.join(repo_root, "services", "gateway") == gateway_root
    assert gateway_root != repo_root


def test_canonical_environment_name_normalizes_legacy_aliases() -> None:
    assert config._canonical_environment_name("development") == "local"
    assert config._canonical_environment_name("dev") == "local"
    assert config._canonical_environment_name("stage") == "staging"
    assert config._canonical_environment_name("production") == "prod"


def test_environment_file_candidates_supports_three_primary_profiles() -> None:
    assert config._environment_file_candidates("local") == [".env.local"]
    assert config._environment_file_candidates("staging") == [".env.staging", ".env.stage"]
    assert config._environment_file_candidates("prod") == [".env.prod", ".env.production"]


def test_environment_file_candidates_keeps_legacy_dev_fallback_compatible() -> None:
    assert config._environment_file_candidates("development") == [
        ".env.development",
        ".env.dev",
        ".env.local",
    ]


def test_withdraw_maturity_enforcement_defaults_to_local_only_bypass() -> None:
    assert _withdraw_maturity_enforcement_default("local") is False
    assert _withdraw_maturity_enforcement_default("dev") is False
    assert _withdraw_maturity_enforcement_default("staging") is True
    assert _withdraw_maturity_enforcement_default("prod") is True


def test_prod_settings_refuse_disabled_withdraw_maturity(monkeypatch) -> None:
    monkeypatch.setattr(config.Settings, "environment", "prod", raising=False)
    monkeypatch.setattr(
        config.Settings,
        "consumer_withdraw_maturity_enforcement_enabled",
        False,
        raising=False,
    )
    monkeypatch.setattr(
        config.Settings,
        "provider_withdraw_maturity_enforcement_enabled",
        True,
        raising=False,
    )

    with pytest.raises(RuntimeError, match="WITHDRAW_MATURITY_ENFORCEMENT_REQUIRED_IN_PROD"):
        config.Settings()
