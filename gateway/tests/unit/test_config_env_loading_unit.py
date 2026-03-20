from src.core import config


def test_resolve_env_file_path_prefers_gateway_root_for_local_env() -> None:
    resolved = config._resolve_env_file_path(".env.local")

    assert resolved.endswith("/gateway/.env.local")


def test_gateway_and_repo_root_dirs_are_distinct() -> None:
    gateway_root = config._gateway_root_dir()
    repo_root = config._repo_root_dir()

    assert gateway_root.endswith("/gateway")
    assert repo_root.endswith("/Synapse-Network")
    assert gateway_root != repo_root