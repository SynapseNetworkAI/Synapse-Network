from src.core import config


def test_resolve_env_file_path_prefers_gateway_root_for_local_template() -> None:
    resolved = config._resolve_env_file_path(".env.local.example")

    assert resolved.endswith("/gateway/.env.local.example")


def test_gateway_and_repo_root_dirs_are_distinct() -> None:
    gateway_root = config._gateway_root_dir()
    repo_root = config._repo_root_dir()

    assert gateway_root.endswith("/gateway")
    assert repo_root.endswith("/Synapse-Network")
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
