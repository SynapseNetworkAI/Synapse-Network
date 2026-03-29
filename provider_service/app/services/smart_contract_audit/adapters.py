from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from json import JSONDecodeError
import json
from typing import Any, Callable, Awaitable, TypeVar

import httpx

from app.core.config import get_settings, parse_json_config


T = TypeVar("T")
CHAIN_NAME_TO_ID = {
    "ethereum": "1",
    "arbitrum": "42161",
    "optimism": "10",
    "base": "8453",
    "polygon": "137",
    "bsc": "56",
}
DEFAULT_BLOCKSCOUT_BASE_URLS = {
    "ethereum": "https://eth.blockscout.com/api",
    "arbitrum": "https://arbitrum.blockscout.com/api",
    "optimism": "https://optimism.blockscout.com/api",
    "base": "https://base.blockscout.com/api",
}


@dataclass(frozen=True)
class VerifiedSourceBundle:
    provider_name: str
    chain: str
    chain_id: str
    contract_address: str
    match: str
    verified_at: datetime | None
    fetched_at: datetime
    source_bundle: str
    source_file_count: int
    contract_name: str | None = None
    compiler_version: str | None = None

    @property
    def freshness_sec(self) -> int:
        if self.verified_at is None:
            return 0
        return max(0, int((self.fetched_at - self.verified_at).total_seconds()))


@dataclass(frozen=True)
class FetchAttemptError:
    provider_name: str
    error_code: str
    message: str


class VerifiedSourceFetchError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        attempts: tuple[FetchAttemptError, ...],
    ) -> None:
        super().__init__(message)
        self.attempts = attempts


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _normalize_address(contract_address: str) -> str:
    return str(contract_address).strip()


def _normalize_chain(chain: str) -> str:
    return str(chain).strip().lower()


def resolve_chain_id(chain: str) -> str:
    normalized = _normalize_chain(chain)
    chain_id = CHAIN_NAME_TO_ID.get(normalized)
    if chain_id is None:
        raise ValueError(f"Unsupported EVM chain mapping for chain={chain!r}")
    return chain_id


def _parse_json_response(response: httpx.Response, *, source_name: str) -> Any:
    try:
        return response.json()
    except JSONDecodeError as exc:
        raise ValueError(
            f"{source_name} returned invalid JSON | status={response.status_code}"
        ) from exc


def _parse_datetime(value: Any) -> datetime | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    return datetime.fromisoformat(normalized.replace("Z", "+00:00")).astimezone(UTC)


def _join_named_source_chunks(files: list[tuple[str, str]]) -> tuple[str, int]:
    source_chunks: list[str] = []
    source_file_count = 0
    for name, content in files:
        normalized_name = str(name or "").strip()
        normalized_content = str(content or "").strip()
        if not normalized_name or not normalized_content:
            continue
        source_chunks.append(f"// File: {normalized_name}\n{normalized_content}\n")
        source_file_count += 1
    if source_file_count == 0:
        raise ValueError("Verified contract has no Solidity source files")
    return "\n".join(source_chunks).strip(), source_file_count


def _sourcify_source_bundle(files_payload: dict[str, Any]) -> tuple[str, int]:
    files = files_payload.get("files")
    if not isinstance(files, list):
        raise ValueError("Sourcify files payload missing files array")

    solidity_files: list[tuple[str, str]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("path") or "").strip()
        content = item.get("content")
        if not name or not isinstance(content, str):
            continue
        if not (name.endswith(".sol") or "/sources/" in str(item.get("path") or "")):
            continue
        solidity_files.append((name, content))
    return _join_named_source_chunks(solidity_files)


def _unwrap_standard_json_source_code(source_code: str) -> dict[str, Any] | None:
    normalized = str(source_code or "").strip()
    if not normalized:
        return None
    candidates = [normalized]
    if normalized.startswith("{{") and normalized.endswith("}}"):
        candidates.append(normalized[1:-1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _explorer_source_bundle(
    *,
    source_code: str,
    contract_name: str | None,
) -> tuple[str, int]:
    normalized = str(source_code or "").strip()
    if not normalized:
        raise LookupError("Explorer returned empty verified source code")

    parsed = _unwrap_standard_json_source_code(normalized)
    if parsed is None:
        synthetic_name = f"{contract_name or 'Contract'}.sol"
        return _join_named_source_chunks([(synthetic_name, normalized)])

    sources = parsed.get("sources")
    if isinstance(sources, dict):
        named_files: list[tuple[str, str]] = []
        for path, item in sources.items():
            if isinstance(item, dict):
                content = item.get("content")
            else:
                content = None
            if not isinstance(content, str):
                continue
            named_files.append((str(path), content))
        return _join_named_source_chunks(named_files)

    raise ValueError("Explorer standard JSON payload missing sources object")


def _configured_blockscout_base_url(chain: str) -> str | None:
    configured = parse_json_config(get_settings().blockscout_base_urls_json)
    if isinstance(configured, dict):
        value = configured.get(_normalize_chain(chain))
        if isinstance(value, str) and value.strip():
            return value.strip()
    return DEFAULT_BLOCKSCOUT_BASE_URLS.get(_normalize_chain(chain))


def _create_async_client(*, base_url: str, timeout_s: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=base_url, timeout=timeout_s)


async def _run_with_client(
    *,
    base_url: str,
    timeout_s: float,
    client: httpx.AsyncClient | None,
    operation: Callable[[httpx.AsyncClient], Awaitable[T]],
) -> T:
    if client is not None:
        return await operation(client)

    current_client = _create_async_client(base_url=base_url, timeout_s=timeout_s)
    try:
        return await operation(current_client)
    finally:
        await current_client.aclose()


async def fetch_sourcify_verified_source_bundle(
    *,
    chain: str,
    contract_address: str,
    client: httpx.AsyncClient | None = None,
) -> VerifiedSourceBundle:
    settings = get_settings()
    chain_id = resolve_chain_id(chain)
    normalized_address = _normalize_address(contract_address)

    async def _operation(current_client: httpx.AsyncClient) -> VerifiedSourceBundle:
        contract_response = await current_client.get(
            f"/server/v2/contract/{chain_id}/{normalized_address}",
            params={"fields": "all"},
        )
        if contract_response.status_code == 404:
            raise LookupError(
                f"Sourcify has no verified contract for {chain}:{normalized_address}"
            )
        contract_response.raise_for_status()
        contract_payload = _parse_json_response(
            contract_response,
            source_name="sourcify_contract",
        )

        files_response = await current_client.get(
            f"/server/files/any/{chain_id}/{normalized_address}",
        )
        if files_response.status_code == 404:
            raise LookupError(
                f"Sourcify files endpoint has no source files for {chain}:{normalized_address}"
            )
        files_response.raise_for_status()
        files_payload = _parse_json_response(
            files_response,
            source_name="sourcify_files",
        )
        source_bundle, source_file_count = _sourcify_source_bundle(files_payload)
        fetched_at = _now_utc()
        return VerifiedSourceBundle(
            provider_name="sourcify_verified_source",
            chain=_normalize_chain(chain),
            chain_id=chain_id,
            contract_address=normalized_address,
            match=str(contract_payload.get("match") or ""),
            verified_at=_parse_datetime(contract_payload.get("verifiedAt")),
            fetched_at=fetched_at,
            source_bundle=source_bundle,
            source_file_count=source_file_count,
        )

    return await _run_with_client(
        base_url=settings.sourcify_base_url,
        timeout_s=settings.sourcify_timeout_s,
        client=client,
        operation=_operation,
    )


async def fetch_blockscout_verified_source_bundle(
    *,
    chain: str,
    contract_address: str,
    client: httpx.AsyncClient | None = None,
) -> VerifiedSourceBundle:
    base_url = _configured_blockscout_base_url(chain)
    if not base_url:
        raise LookupError(f"Blockscout is not configured for chain={chain}")
    chain_id = resolve_chain_id(chain)
    normalized_address = _normalize_address(contract_address)
    settings = get_settings()

    async def _operation(current_client: httpx.AsyncClient) -> VerifiedSourceBundle:
        response = await current_client.get(
            "",
            params={
                "module": "contract",
                "action": "getsourcecode",
                "address": normalized_address,
            },
        )
        response.raise_for_status()
        payload = _parse_json_response(response, source_name="blockscout_getsourcecode")
        result = payload.get("result")
        if not isinstance(result, list) or not result:
            raise LookupError(
                f"Blockscout returned no verified source entries for {chain}:{normalized_address}"
            )
        contract_record = result[0]
        if not isinstance(contract_record, dict):
            raise ValueError("Blockscout getsourcecode payload is malformed")
        source_bundle, source_file_count = _explorer_source_bundle(
            source_code=str(contract_record.get("SourceCode") or ""),
            contract_name=str(contract_record.get("ContractName") or "") or None,
        )
        fetched_at = _now_utc()
        return VerifiedSourceBundle(
            provider_name="blockscout_verified_source",
            chain=_normalize_chain(chain),
            chain_id=chain_id,
            contract_address=normalized_address,
            match="verified",
            verified_at=None,
            fetched_at=fetched_at,
            source_bundle=source_bundle,
            source_file_count=source_file_count,
            contract_name=str(contract_record.get("ContractName") or "") or None,
            compiler_version=str(contract_record.get("CompilerVersion") or "") or None,
        )

    return await _run_with_client(
        base_url=base_url,
        timeout_s=settings.blockscout_timeout_s,
        client=client,
        operation=_operation,
    )


async def fetch_etherscan_verified_source_bundle(
    *,
    chain: str,
    contract_address: str,
    client: httpx.AsyncClient | None = None,
) -> VerifiedSourceBundle:
    settings = get_settings()
    api_key = str(settings.etherscan_api_key or "").strip()
    if not api_key:
        raise LookupError("Etherscan API key is not configured")
    chain_id = resolve_chain_id(chain)
    normalized_address = _normalize_address(contract_address)

    async def _operation(current_client: httpx.AsyncClient) -> VerifiedSourceBundle:
        response = await current_client.get(
            "",
            params={
                "chainid": chain_id,
                "module": "contract",
                "action": "getsourcecode",
                "address": normalized_address,
                "apikey": api_key,
            },
        )
        response.raise_for_status()
        payload = _parse_json_response(response, source_name="etherscan_getsourcecode")
        result = payload.get("result")
        if not isinstance(result, list) or not result:
            raise LookupError(
                f"Etherscan returned no verified source entries for {chain}:{normalized_address}"
            )
        contract_record = result[0]
        if not isinstance(contract_record, dict):
            raise ValueError("Etherscan getsourcecode payload is malformed")
        source_bundle, source_file_count = _explorer_source_bundle(
            source_code=str(contract_record.get("SourceCode") or ""),
            contract_name=str(contract_record.get("ContractName") or "") or None,
        )
        fetched_at = _now_utc()
        return VerifiedSourceBundle(
            provider_name="etherscan_verified_source",
            chain=_normalize_chain(chain),
            chain_id=chain_id,
            contract_address=normalized_address,
            match="verified",
            verified_at=None,
            fetched_at=fetched_at,
            source_bundle=source_bundle,
            source_file_count=source_file_count,
            contract_name=str(contract_record.get("ContractName") or "") or None,
            compiler_version=str(contract_record.get("CompilerVersion") or "") or None,
        )

    return await _run_with_client(
        base_url=settings.etherscan_base_url,
        timeout_s=settings.etherscan_timeout_s,
        client=client,
        operation=_operation,
    )


async def fetch_verified_source_bundle_with_fallback(
    *,
    chain: str,
    contract_address: str,
) -> tuple[VerifiedSourceBundle, tuple[FetchAttemptError, ...]]:
    attempts: list[FetchAttemptError] = []

    for provider_name, fetcher in (
        ("sourcify_verified_source", fetch_sourcify_verified_source_bundle),
        ("blockscout_verified_source", fetch_blockscout_verified_source_bundle),
        ("etherscan_verified_source", fetch_etherscan_verified_source_bundle),
    ):
        try:
            bundle = await fetcher(chain=chain, contract_address=contract_address)
            return bundle, tuple(attempts)
        except LookupError as exc:
            attempts.append(
                FetchAttemptError(
                    provider_name=provider_name,
                    error_code="VERIFIED_SOURCE_NOT_FOUND",
                    message=str(exc),
                )
            )
        except ValueError as exc:
            attempts.append(
                FetchAttemptError(
                    provider_name=provider_name,
                    error_code="VERIFIED_SOURCE_INVALID",
                    message=str(exc),
                )
            )
        except Exception as exc:  # noqa: BLE001
            attempts.append(
                FetchAttemptError(
                    provider_name=provider_name,
                    error_code="VERIFIED_SOURCE_FETCH_FAILED",
                    message=str(exc),
                )
            )

    raise VerifiedSourceFetchError(
        f"No verified source provider returned source code for {chain}:{contract_address}",
        attempts=tuple(attempts),
    )
