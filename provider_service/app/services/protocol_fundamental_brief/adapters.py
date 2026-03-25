from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
from json import JSONDecodeError
from typing import Any, Awaitable, Callable, TypeVar

import httpx

from app.core.config import get_settings
from app.core.log_config import logger
from app.schemas.protocol_fundamental_brief import (
    DefiLlamaPayloadExcerpt,
    DexScreenerPayloadExcerpt,
)


T = TypeVar("T")
adapter_logger = logger.bind(component="protocol_brief_source_adapter")
PREFERRED_QUOTE_TOKENS = {
    "USDC": 2,
    "USDT": 2,
    "DAI": 2,
    "FDUSD": 2,
    "ETH": 1,
    "WETH": 1,
    "WBTC": 1,
    "SOL": 1,
}


@dataclass(frozen=True)
class DefiLlamaProtocolSnapshot:
    protocol_query: str
    protocol_slug: str
    display_name: str
    protocol_symbol: str | None
    category: str | None
    supported_chains: tuple[str, ...]
    chain_tvl_breakdown: dict[str, float]
    tvl_usd_current: float | None
    tvl_change_1d_pct: float | None
    tvl_change_7d_pct: float | None
    tvl_change_30d_pct: float | None
    fees_24h_usd: float | None
    fees_7d_usd: float | None
    fees_30d_usd: float | None
    revenue_24h_usd: float | None
    revenue_7d_usd: float | None
    revenue_30d_usd: float | None
    source_timestamp: datetime
    fetched_at: datetime
    http_status: int
    latency_ms: int
    retry_count: int
    timeout_ms: int
    payload_hash: str
    payload_excerpt: DefiLlamaPayloadExcerpt

    @property
    def freshness_sec(self) -> int:
        delta = self.fetched_at - self.source_timestamp
        return max(0, int(delta.total_seconds()))


@dataclass(frozen=True)
class DexScreenerMarketSnapshot:
    protocol_query: str
    chain_id: str
    pair_address: str
    dex_id: str
    base_token_symbol: str
    quote_token_symbol: str
    labels: tuple[str, ...]
    spot_price_usd: float | None
    price_change_5m_pct: float | None
    price_change_1h_pct: float | None
    price_change_6h_pct: float | None
    price_change_24h_pct: float | None
    volume_24h_usd: float
    buy_txn_24h: int
    sell_txn_24h: int
    liquidity_usd: float
    market_cap_usd: float | None
    fdv_usd: float | None
    pair_created_at: datetime | None
    source_timestamp: datetime
    fetched_at: datetime
    http_status: int
    latency_ms: int
    retry_count: int
    timeout_ms: int
    payload_hash: str
    payload_excerpt: DexScreenerPayloadExcerpt

    @property
    def freshness_sec(self) -> int:
        delta = self.fetched_at - self.source_timestamp
        return max(0, int(delta.total_seconds()))

    @property
    def pair_age_days(self) -> int | None:
        if self.pair_created_at is None:
            return None
        delta = self.fetched_at - self.pair_created_at
        return max(0, int(delta.total_seconds() // 86400))


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _response_preview(response: httpx.Response, *, limit: int = 160) -> str:
    preview = response.text[:limit].replace("\n", "\\n").replace("\r", "\\r")
    return preview


def _parse_json_response(response: httpx.Response, *, source_name: str) -> Any:
    try:
        return response.json()
    except JSONDecodeError as exc:
        content_type = response.headers.get("content-type", "")
        preview = _response_preview(response)
        raise ValueError(
            f"{source_name} returned invalid JSON"
            f" | status={response.status_code}"
            f" | content_type={content_type or 'unknown'}"
            f" | preview={preview!r}"
        ) from exc


def _payload_hash(payload: Any) -> str:
    normalized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


def _parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_int(value: Any) -> int:
    if value is None or value == "":
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_key(value: Any) -> str:
    return _normalize_text(value).lower()


def _create_async_client(*, base_url: str, timeout_s: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=base_url, timeout=timeout_s)


async def _run_with_adapter_client(
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


async def _run_with_retry(
    source_name: str,
    timeout_s: float,
    operation: Callable[[], Awaitable[T]],
) -> tuple[T, int, int, int]:
    settings = get_settings()
    max_attempts = max(1, settings.protocol_brief_source_max_attempts)
    backoff_ms = max(0, settings.protocol_brief_source_backoff_ms)
    last_error: BaseException | None = None

    for attempt in range(1, max_attempts + 1):
        started = _now_utc()
        try:
            result = await operation()
            latency_ms = int((_now_utc() - started).total_seconds() * 1000)
            return result, attempt - 1, latency_ms, int(timeout_s * 1000)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == max_attempts:
                raise RuntimeError(
                    f"{source_name} fetch failed after {max_attempts} attempts: {exc}"
                ) from exc
            await asyncio.sleep((backoff_ms * attempt) / 1000)

    raise RuntimeError(f"{source_name} fetch failed: {last_error}")


def _find_protocol_candidate(protocols: list[dict[str, Any]], query: str) -> dict[str, Any]:
    normalized_query = _normalize_key(query)
    exact_slug_matches = [
        item for item in protocols if _normalize_key(item.get("slug")) == normalized_query
    ]
    if len(exact_slug_matches) == 1:
        return exact_slug_matches[0]

    exact_name_matches = [
        item for item in protocols if _normalize_key(item.get("name")) == normalized_query
    ]
    if len(exact_name_matches) == 1:
        return exact_name_matches[0]

    exact_symbol_matches = [
        item for item in protocols if _normalize_key(item.get("symbol")) == normalized_query
    ]
    if len(exact_symbol_matches) == 1:
        return exact_symbol_matches[0]
    if len(exact_symbol_matches) > 1:
        raise ValueError(
            "DefiLlama protocol lookup is ambiguous; matched multiple protocols by symbol"
        )

    for item in protocols:
        name = _normalize_key(item.get("name"))
        slug = _normalize_key(item.get("slug"))
        symbol = _normalize_key(item.get("symbol"))
        if normalized_query in {name, slug, symbol}:
            return item

    raise ValueError(f"DefiLlama protocol not found for query={query!r}")


def _nearest_tvl_change_pct(total_data_chart: list[list[Any]], lookback_days: int) -> float | None:
    if len(total_data_chart) < 2:
        return None
    latest_row = total_data_chart[-1]
    latest_value = _parse_float(latest_row[1])
    latest_ts_ms = _parse_int(latest_row[0])
    if latest_value in (None, 0):
        return None

    target_ts_ms = latest_ts_ms - (lookback_days * 86400 * 1000)
    candidate_row = min(
        total_data_chart[:-1],
        key=lambda row: abs(_parse_int(row[0]) - target_ts_ms),
    )
    historical_value = _parse_float(candidate_row[1])
    if historical_value in (None, 0):
        return None
    return round(((latest_value - historical_value) / historical_value) * 100, 4)


def _extract_chain_tvl_breakdown(protocol_payload: dict[str, Any]) -> dict[str, float]:
    breakdown: dict[str, float] = {}
    raw_chain_tvls = (
        protocol_payload.get("currentChainTvls")
        or protocol_payload.get("chainTvls")
        or {}
    )
    if isinstance(raw_chain_tvls, dict):
        for chain_name, chain_value in raw_chain_tvls.items():
            if isinstance(chain_value, dict):
                total_liquidity = _parse_float(chain_value.get("tvl"))
            else:
                total_liquidity = _parse_float(chain_value)
            if total_liquidity is not None:
                breakdown[_normalize_text(chain_name)] = total_liquidity
    return breakdown


def _extract_source_timestamp(protocol_payload: dict[str, Any], *, fallback: datetime) -> datetime:
    total_data_chart = protocol_payload.get("totalDataChart") or []
    if isinstance(total_data_chart, list) and total_data_chart:
        latest_row = total_data_chart[-1]
        latest_ts_ms = _parse_int(latest_row[0])
        if latest_ts_ms > 0:
            return datetime.fromtimestamp(latest_ts_ms / 1000, tz=UTC)
    return fallback


def _summary_value(summary_payload: dict[str, Any] | None, *keys: str) -> float | None:
    if not summary_payload:
        return None
    for key in keys:
        value = _parse_float(summary_payload.get(key))
        if value is not None:
            return value
    total_data_chart = summary_payload.get("totalDataChart") or []
    if isinstance(total_data_chart, list) and total_data_chart:
        latest_row = total_data_chart[-1]
        if isinstance(latest_row, list) and len(latest_row) >= 2:
            return _parse_float(latest_row[1])
    return None


async def _fetch_defillama_payloads(
    protocol: str,
    *,
    client: httpx.AsyncClient | None,
    base_url: str,
    timeout_s: float,
) -> tuple[
    httpx.Response,
    httpx.Response,
    httpx.Response | None,
    dict[str, Any],
    dict[str, Any],
    dict[str, Any] | None,
    datetime,
]:
    async def _operation() -> tuple[
        httpx.Response,
        httpx.Response,
        httpx.Response | None,
        dict[str, Any],
        dict[str, Any],
        dict[str, Any] | None,
        datetime,
    ]:
        async def _execute(
            current_client: httpx.AsyncClient,
        ) -> tuple[
            httpx.Response,
            httpx.Response,
            httpx.Response | None,
            dict[str, Any],
            dict[str, Any],
            dict[str, Any] | None,
            datetime,
        ]:
            fetched_at = _now_utc()
            protocols_response = await current_client.get("/protocols", timeout=timeout_s)
            protocols_response.raise_for_status()
            protocols_payload = _parse_json_response(
                protocols_response,
                source_name="defillama_protocol protocols",
            )
            if not isinstance(protocols_payload, list):
                raise ValueError("DefiLlama /protocols returned a non-list payload")

            candidate = _find_protocol_candidate(protocols_payload, protocol)
            protocol_slug = _normalize_text(candidate.get("slug") or candidate.get("name"))
            protocol_response, fees_response = await asyncio.gather(
                current_client.get(f"/protocol/{protocol_slug}", timeout=timeout_s),
                current_client.get(f"/summary/fees/{protocol_slug}", timeout=timeout_s),
                return_exceptions=True,
            )
            if isinstance(protocol_response, BaseException):
                raise protocol_response
            protocol_response.raise_for_status()
            protocol_payload = _parse_json_response(
                protocol_response,
                source_name="defillama_protocol detail",
            )
            parsed_fees_response, fees_payload = _parse_defillama_fees_response(
                fees_response,
                protocol_slug=protocol_slug,
            )
            return (
                protocols_response,
                protocol_response,
                parsed_fees_response,
                candidate,
                protocol_payload,
                fees_payload,
                fetched_at,
            )

        return await _run_with_adapter_client(
            base_url=base_url,
            timeout_s=timeout_s,
            client=client,
            operation=_execute,
        )

    return await _run_with_retry("defillama_protocol", timeout_s, _operation)


def _parse_defillama_fees_response(
    fees_response: httpx.Response | BaseException,
    *,
    protocol_slug: str,
) -> tuple[httpx.Response | None, dict[str, Any] | None]:
    if isinstance(fees_response, BaseException):
        return None, None
    if fees_response.status_code >= 400:
        adapter_logger.warning(
            "Protocol brief fees endpoint degraded"
            f" | source=defillama_protocol"
            f" | protocol={protocol_slug}"
            f" | status={fees_response.status_code}"
        )
        return None, None
    return fees_response, _parse_json_response(
        fees_response,
        source_name="defillama_protocol fees",
    )


def _build_defillama_snapshot(
    *,
    protocol: str,
    protocols_response: httpx.Response,
    protocol_response: httpx.Response,
    fees_response: httpx.Response | None,
    candidate_payload: dict[str, Any],
    protocol_payload: dict[str, Any],
    fees_payload: dict[str, Any] | None,
    fetched_at: datetime,
    retry_count: int,
    latency_ms: int,
    timeout_ms: int,
) -> DefiLlamaProtocolSnapshot:
    protocol_slug = _normalize_text(
        candidate_payload.get("slug") or protocol_payload.get("slug") or protocol
    )
    supported_chains = tuple(
        _normalize_text(chain)
        for chain in (
            protocol_payload.get("chains") or candidate_payload.get("chains") or []
        )
        if _normalize_text(chain)
    )
    total_data_chart = protocol_payload.get("totalDataChart") or []
    excerpt = DefiLlamaPayloadExcerpt(
        protocolSlug=protocol_slug,
        displayName=_normalize_text(
            candidate_payload.get("name") or protocol_payload.get("name") or protocol_slug
        ),
        category=_normalize_text(
            candidate_payload.get("category") or protocol_payload.get("category")
        )
        or None,
        tvlUsd=_parse_float(protocol_payload.get("tvl") or candidate_payload.get("tvl")),
        chainCount=len(supported_chains),
        fees24hUsd=_summary_value(fees_payload, "total24h", "total24hFees", "fees24h"),
        revenue24hUsd=_summary_value(
            fees_payload,
            "total24hRevenue",
            "revenue24h",
        ),
    )
    http_status = max(
        protocols_response.status_code,
        protocol_response.status_code,
        fees_response.status_code if fees_response is not None else 0,
    )
    return DefiLlamaProtocolSnapshot(
        protocol_query=protocol,
        protocol_slug=protocol_slug,
        display_name=excerpt.display_name,
        protocol_symbol=_normalize_text(
            candidate_payload.get("symbol") or protocol_payload.get("symbol")
        )
        or None,
        category=excerpt.category,
        supported_chains=supported_chains,
        chain_tvl_breakdown=_extract_chain_tvl_breakdown(protocol_payload),
        tvl_usd_current=excerpt.tvl_usd,
        tvl_change_1d_pct=_parse_float(
            protocol_payload.get("change_1d") or candidate_payload.get("change_1d")
        ),
        tvl_change_7d_pct=_parse_float(
            protocol_payload.get("change_7d") or candidate_payload.get("change_7d")
        ),
        tvl_change_30d_pct=_nearest_tvl_change_pct(total_data_chart, 30),
        fees_24h_usd=excerpt.fees_24h_usd,
        fees_7d_usd=_summary_value(fees_payload, "total7d", "total7dFees", "fees7d"),
        fees_30d_usd=_summary_value(
            fees_payload,
            "total30d",
            "total30dFees",
            "fees30d",
        ),
        revenue_24h_usd=excerpt.revenue_24h_usd,
        revenue_7d_usd=_summary_value(
            fees_payload,
            "total7dRevenue",
            "revenue7d",
        ),
        revenue_30d_usd=_summary_value(
            fees_payload,
            "total30dRevenue",
            "revenue30d",
        ),
        source_timestamp=_extract_source_timestamp(protocol_payload, fallback=fetched_at),
        fetched_at=fetched_at,
        http_status=http_status,
        latency_ms=latency_ms,
        retry_count=retry_count,
        timeout_ms=timeout_ms,
        payload_hash=_payload_hash(
            {
                "candidate": candidate_payload,
                "protocol": protocol_payload,
                "fees": fees_payload,
            }
        ),
        payload_excerpt=excerpt,
    )


async def fetch_defillama_protocol_snapshot(
    protocol: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> DefiLlamaProtocolSnapshot:
    settings = get_settings()
    timeout_s = settings.defillama_timeout_s or settings.protocol_brief_source_timeout_s
    (
        protocols_response,
        protocol_response,
        fees_response,
        candidate_payload,
        protocol_payload,
        fees_payload,
        fetched_at,
    ), retry_count, latency_ms, timeout_ms = await _fetch_defillama_payloads(
        protocol,
        client=client,
        base_url=settings.defillama_base_url,
        timeout_s=timeout_s,
    )

    snapshot = _build_defillama_snapshot(
        protocol=protocol,
        protocols_response=protocols_response,
        protocol_response=protocol_response,
        fees_response=fees_response,
        candidate_payload=candidate_payload,
        protocol_payload=protocol_payload,
        fees_payload=fees_payload,
        fetched_at=fetched_at,
        retry_count=retry_count,
        latency_ms=latency_ms,
        timeout_ms=timeout_ms,
    )
    adapter_logger.info(
        "Protocol brief source fetch succeeded"
        " | source=defillama_protocol"
        f" | protocol={snapshot.protocol_slug}"
        f" | tvl_usd_current={snapshot.tvl_usd_current}"
        f" | latency_ms={snapshot.latency_ms}"
        f" | retry_count={snapshot.retry_count}"
        f" | freshness_sec={snapshot.freshness_sec}"
        f" | http_status={snapshot.http_status}"
    )
    return snapshot


def _chain_matches(requested_chain: str | None, pair: dict[str, Any]) -> bool:
    if not requested_chain:
        return True
    return _normalize_key(pair.get("chainId")) == _normalize_key(requested_chain)


def _pair_score(requested_chain: str | None, pair: dict[str, Any]) -> tuple[int, float, float, int]:
    chain_priority = 1 if _chain_matches(requested_chain, pair) else 0
    liquidity_usd = _parse_float((pair.get("liquidity") or {}).get("usd")) or 0.0
    volume_24h = _parse_float((pair.get("volume") or {}).get("h24")) or 0.0
    quote_symbol = _normalize_text((pair.get("quoteToken") or {}).get("symbol")).upper()
    quote_priority = PREFERRED_QUOTE_TOKENS.get(quote_symbol, 0)
    return (chain_priority, liquidity_usd, volume_24h, quote_priority)


def _select_best_pair(
    protocol: str,
    requested_chain: str | None,
    pairs: list[dict[str, Any]],
) -> dict[str, Any]:
    matching_pairs = [pair for pair in pairs if _chain_matches(requested_chain, pair)]
    candidate_pairs = matching_pairs or pairs
    if not candidate_pairs:
        raise ValueError(f"DexScreener returned no pairs for protocol={protocol!r}")
    return max(candidate_pairs, key=lambda pair: _pair_score(requested_chain, pair))


async def fetch_dexscreener_market_snapshot(
    protocol: str,
    *,
    chain: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> DexScreenerMarketSnapshot:
    settings = get_settings()
    timeout_s = settings.dexscreener_timeout_s or settings.protocol_brief_source_timeout_s

    async def _operation() -> tuple[httpx.Response, dict[str, Any], datetime]:
        async def _execute(
            current_client: httpx.AsyncClient,
        ) -> tuple[httpx.Response, dict[str, Any], datetime]:
            fetched_at = _now_utc()
            response = await current_client.get(
                "/latest/dex/search",
                params={"q": protocol},
                timeout=timeout_s,
            )
            response.raise_for_status()
            return (
                response,
                _parse_json_response(
                    response,
                    source_name="dexscreener_market search",
                ),
                fetched_at,
            )

        return await _run_with_adapter_client(
            base_url=settings.dexscreener_base_url,
            timeout_s=timeout_s,
            client=client,
            operation=_execute,
        )

    (
        response,
        payload,
        fetched_at,
    ), retry_count, latency_ms, timeout_ms = await _run_with_retry(
        "dexscreener_market",
        timeout_s,
        _operation,
    )
    pairs = payload.get("pairs") or []
    if not isinstance(pairs, list):
        raise ValueError("DexScreener /latest/dex/search returned a non-list pair set")
    selected_pair = _select_best_pair(protocol, chain, pairs)
    price_change_payload = selected_pair.get("priceChange") or {}
    txns_payload = (selected_pair.get("txns") or {}).get("h24") or {}
    pair_created_at_ms = _parse_int(selected_pair.get("pairCreatedAt"))
    pair_created_at = (
        datetime.fromtimestamp(pair_created_at_ms / 1000, tz=UTC)
        if pair_created_at_ms > 0
        else None
    )
    excerpt = DexScreenerPayloadExcerpt(
        chainId=_normalize_text(selected_pair.get("chainId")),
        pairAddress=_normalize_text(selected_pair.get("pairAddress")),
        dexId=_normalize_text(selected_pair.get("dexId")),
        baseSymbol=_normalize_text((selected_pair.get("baseToken") or {}).get("symbol")),
        quoteSymbol=_normalize_text((selected_pair.get("quoteToken") or {}).get("symbol")),
        liquidityUsd=_parse_float((selected_pair.get("liquidity") or {}).get("usd"))
        or 0.0,
        volume24hUsd=_parse_float((selected_pair.get("volume") or {}).get("h24"))
        or 0.0,
    )
    snapshot = DexScreenerMarketSnapshot(
        protocol_query=protocol,
        chain_id=excerpt.chain_id,
        pair_address=excerpt.pair_address,
        dex_id=excerpt.dex_id,
        base_token_symbol=excerpt.base_symbol,
        quote_token_symbol=excerpt.quote_symbol,
        labels=tuple(str(label) for label in (selected_pair.get("labels") or [])),
        spot_price_usd=_parse_float(selected_pair.get("priceUsd")),
        price_change_5m_pct=_parse_float(price_change_payload.get("m5")),
        price_change_1h_pct=_parse_float(price_change_payload.get("h1")),
        price_change_6h_pct=_parse_float(price_change_payload.get("h6")),
        price_change_24h_pct=_parse_float(price_change_payload.get("h24")),
        volume_24h_usd=excerpt.volume_24h_usd,
        buy_txn_24h=_parse_int(txns_payload.get("buys")),
        sell_txn_24h=_parse_int(txns_payload.get("sells")),
        liquidity_usd=excerpt.liquidity_usd,
        market_cap_usd=_parse_float(selected_pair.get("marketCap")),
        fdv_usd=_parse_float(selected_pair.get("fdv")),
        pair_created_at=pair_created_at,
        source_timestamp=fetched_at,
        fetched_at=fetched_at,
        http_status=response.status_code,
        latency_ms=latency_ms,
        retry_count=retry_count,
        timeout_ms=timeout_ms,
        payload_hash=_payload_hash(selected_pair),
        payload_excerpt=excerpt,
    )
    adapter_logger.info(
        "Protocol brief source fetch succeeded"
        " | source=dexscreener_market"
        f" | protocol={protocol}"
        f" | pair_address={snapshot.pair_address}"
        f" | chain_id={snapshot.chain_id}"
        f" | liquidity_usd={snapshot.liquidity_usd}"
        f" | volume_24h_usd={snapshot.volume_24h_usd}"
        f" | latency_ms={snapshot.latency_ms}"
        f" | retry_count={snapshot.retry_count}"
    )
    return snapshot