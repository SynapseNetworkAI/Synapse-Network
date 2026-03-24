from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
from json import JSONDecodeError
import math
from statistics import pstdev
from threading import Lock
import time
from typing import Any, Awaitable, Callable, TypeVar

import httpx

from app.core.config import get_settings, parse_json_config
from app.core.log_config import logger
from app.schemas.sentiment import (
    AlternativeMePayloadExcerpt,
    BinancePayloadExcerpt,
    CoinGeckoPayloadExcerpt,
)


SYMBOL_TO_COINGECKO_ID = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
}

SYMBOL_TO_BINANCE_MARKET = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "SOL": "SOLUSDT",
}

T = TypeVar("T")
adapter_logger = logger.bind(component="sentiment_source_adapter")
_proxy_pool_lock = Lock()
_proxy_pool_offsets: dict[tuple[str, ...], int] = {}


class ProxyPoolConfigurationError(ValueError):
    pass


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


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _parse_datetime(value: str | None, *, fallback: datetime) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        return fallback
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized).astimezone(UTC)
    except ValueError:
        return fallback


@dataclass(frozen=True)
class AlternativeMeSentimentSnapshot:
    value: int
    classification: str
    source_timestamp: datetime
    fetched_at: datetime
    http_status: int
    latency_ms: int
    retry_count: int
    timeout_ms: int
    payload_hash: str
    payload_excerpt: AlternativeMePayloadExcerpt

    @property
    def freshness_sec(self) -> int:
        delta = self.fetched_at - self.source_timestamp
        return max(0, int(delta.total_seconds()))


@dataclass(frozen=True)
class CoinGeckoMarketSnapshot:
    symbol: str
    price_usd: float
    change_24h_pct: float
    volume_24h_usd: float
    market_cap_rank: int | None
    source_timestamp: datetime
    fetched_at: datetime
    http_status: int
    latency_ms: int
    retry_count: int
    timeout_ms: int
    payload_hash: str
    payload_excerpt: CoinGeckoPayloadExcerpt

    @property
    def freshness_sec(self) -> int:
        delta = self.fetched_at - self.source_timestamp
        return max(0, int(delta.total_seconds()))


@dataclass(frozen=True)
class BinanceMarketSnapshot:
    symbol: str
    market_symbol: str
    last_price_usd: float
    price_change_pct: float
    quote_volume_usd: float
    realized_volatility_pct: float
    source_timestamp: datetime
    fetched_at: datetime
    http_status: int
    latency_ms: int
    retry_count: int
    timeout_ms: int
    payload_hash: str
    payload_excerpt: BinancePayloadExcerpt

    @property
    def freshness_sec(self) -> int:
        delta = self.fetched_at - self.source_timestamp
        return max(0, int(delta.total_seconds()))


def _realized_volatility_pct(close_prices: list[float]) -> float:
    if len(close_prices) < 2:
        return 0.0
    log_returns = [
        math.log(current / previous)
        for previous, current in zip(close_prices, close_prices[1:])
        if previous > 0 and current > 0
    ]
    if not log_returns:
        return 0.0
    return round(pstdev(log_returns) * 100, 4)


def _payload_hash(payload: Any) -> str:
    normalized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


def _split_proxy_pool_value(raw_value: str) -> tuple[str, ...]:
    normalized = raw_value.strip()
    if not normalized:
        return ()
    if normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1].strip()
    if not normalized:
        return ()
    proxy_urls = []
    for item in normalized.split(","):
        candidate = item.strip().strip('"').strip("'")
        if candidate:
            proxy_urls.append(candidate)
    return tuple(proxy_urls)


def _parse_proxy_pool_urls(raw_value: str) -> tuple[str, ...]:
    try:
        configured_urls = parse_json_config(raw_value)
    except JSONDecodeError:
        return _split_proxy_pool_value(raw_value)
    if isinstance(configured_urls, list):
        return tuple(str(item).strip() for item in configured_urls if str(item).strip())
    raise ProxyPoolConfigurationError(
        "SENTIMENT_PROXY_POOL_URLS_JSON must be a JSON array of proxy URLs"
    )


def proxy_pool_size() -> int:
    return len(_proxy_pool_urls())


def _proxy_pool_urls() -> tuple[str, ...]:
    settings = get_settings()
    if not settings.sentiment_proxy_pool_enabled:
        return ()
    proxy_urls = _parse_proxy_pool_urls(settings.sentiment_proxy_pool_urls_json)
    if not proxy_urls:
        raise ProxyPoolConfigurationError(
            "SENTIMENT_PROXY_POOL_ENABLED=true requires SENTIMENT_PROXY_POOL_URLS_JSON to contain at least one proxy URL"
        )
    return proxy_urls


def _next_proxy_url() -> str | None:
    proxy_urls = _proxy_pool_urls()
    if not proxy_urls:
        return None
    with _proxy_pool_lock:
        next_index = _proxy_pool_offsets.get(proxy_urls, 0)
        selected_url = proxy_urls[next_index % len(proxy_urls)]
        _proxy_pool_offsets[proxy_urls] = (next_index + 1) % len(proxy_urls)
    return selected_url


def _create_async_client(
    *,
    base_url: str,
    timeout_s: float,
    proxy_url: str | None,
) -> httpx.AsyncClient:
    client_kwargs: dict[str, Any] = {
        "base_url": base_url,
        "timeout": timeout_s,
    }
    if proxy_url:
        client_kwargs["proxy"] = proxy_url
    return httpx.AsyncClient(**client_kwargs)


def _effective_timeout_s(timeout_s: float) -> float:
    settings = get_settings()
    if settings.sentiment_proxy_pool_enabled:
        return max(timeout_s, settings.sentiment_proxy_timeout_floor_s)
    return timeout_s


async def _run_with_adapter_client(
    *,
    source_name: str,
    base_url: str,
    timeout_s: float,
    client: httpx.AsyncClient | None,
    operation: Callable[[httpx.AsyncClient], Awaitable[T]],
) -> T:
    if client is not None:
        return await operation(client)

    proxy_url = _next_proxy_url()
    current_client = _create_async_client(
        base_url=base_url,
        timeout_s=timeout_s,
        proxy_url=proxy_url,
    )
    try:
        if proxy_url:
            adapter_logger.info(
                "Sentiment source fetch using proxy"
                f" | source={source_name}"
                f" | proxy={proxy_url}"
            )
        return await operation(current_client)
    finally:
        await current_client.aclose()


async def _run_with_retry(
    source_name: str,
    timeout_s: float,
    operation: Callable[[], Awaitable[T]],
) -> tuple[T, int, int, int]:
    settings = get_settings()
    max_attempts = max(1, settings.sentiment_source_max_attempts)
    backoff_ms = max(0, settings.sentiment_source_backoff_ms)
    last_error: BaseException | None = None

    for attempt in range(1, max_attempts + 1):
        start = time.perf_counter()
        try:
            result = await operation()
            latency_ms = int((time.perf_counter() - start) * 1000)
            return result, attempt - 1, latency_ms, int(timeout_s * 1000)
        except ProxyPoolConfigurationError:
            raise
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            error_text = str(exc) or exc.__class__.__name__
            if attempt == max_attempts:
                raise RuntimeError(
                    f"{source_name} fetch failed after {max_attempts} attempts: {error_text}"
                ) from exc
            await asyncio.sleep((backoff_ms * attempt) / 1000)

    raise RuntimeError(f"{source_name} fetch failed: {last_error}")


async def fetch_alternative_me_sentiment(
    *, client: httpx.AsyncClient | None = None
) -> AlternativeMeSentimentSnapshot:
    settings = get_settings()
    timeout_s = _effective_timeout_s(
        settings.alternative_me_timeout_s or settings.sentiment_source_timeout_s
    )
    async def _operation() -> tuple[httpx.Response, dict[str, Any], datetime]:
        async def _execute(current_client: httpx.AsyncClient) -> tuple[httpx.Response, dict[str, Any], datetime]:
            fetched_at = _now_utc()
            response = await current_client.get(
                "/fng/",
                params={"limit": 1, "format": "json"},
                timeout=timeout_s,
            )
            response.raise_for_status()
            return response, _parse_json_response(response, source_name="alternative_me"), fetched_at

        return await _run_with_adapter_client(
            source_name="alternative_me",
            base_url=settings.alternative_me_base_url,
            timeout_s=timeout_s,
            client=client,
            operation=_execute,
        )

    (response, payload, fetched_at), retry_count, latency_ms, timeout_ms = await _run_with_retry(
        "alternative_me",
        timeout_s,
        _operation,
    )
    data = payload.get("data") or []
    if not data:
        raise ValueError("Alternative.me returned empty data array")
    item = data[0]
    value = int(item["value"])
    classification = str(item.get("value_classification") or "unknown").strip().lower()
    timestamp = datetime.fromtimestamp(int(item["timestamp"]), tz=UTC)
    excerpt = AlternativeMePayloadExcerpt(
        value=value,
        classification=classification,
        timestamp=int(item["timestamp"]),
    )
    snapshot = AlternativeMeSentimentSnapshot(
        value=value,
        classification=classification,
        source_timestamp=timestamp,
        fetched_at=fetched_at,
        http_status=response.status_code,
        latency_ms=latency_ms,
        retry_count=retry_count,
        timeout_ms=timeout_ms,
        payload_hash=_payload_hash(payload),
        payload_excerpt=excerpt,
    )
    adapter_logger.info(
        "Sentiment source fetch succeeded"
        " | source=alternative_me"
        f" | classification={snapshot.classification}"
        f" | value={snapshot.value}"
        f" | latency_ms={snapshot.latency_ms}"
        f" | retry_count={snapshot.retry_count}"
        f" | freshness_sec={snapshot.freshness_sec}"
        f" | http_status={snapshot.http_status}"
    )
    return snapshot


async def fetch_coingecko_market_snapshot(
    symbol: str, *, client: httpx.AsyncClient | None = None
) -> CoinGeckoMarketSnapshot:
    settings = get_settings()
    timeout_s = _effective_timeout_s(
        settings.coingecko_timeout_s or settings.sentiment_source_timeout_s
    )
    coin_id = SYMBOL_TO_COINGECKO_ID[symbol]
    async def _operation() -> tuple[httpx.Response, list[dict[str, Any]], datetime]:
        async def _execute(current_client: httpx.AsyncClient) -> tuple[httpx.Response, list[dict[str, Any]], datetime]:
            fetched_at = _now_utc()
            response = await current_client.get(
                "/coins/markets",
                params={
                    "vs_currency": "usd",
                    "ids": coin_id,
                    "price_change_percentage": "24h",
                },
                timeout=timeout_s,
            )
            response.raise_for_status()
            return response, _parse_json_response(response, source_name="coingecko"), fetched_at

        return await _run_with_adapter_client(
            source_name="coingecko",
            base_url=settings.coingecko_base_url,
            timeout_s=timeout_s,
            client=client,
            operation=_execute,
        )

    (response, payload, fetched_at), retry_count, latency_ms, timeout_ms = await _run_with_retry(
        "coingecko",
        timeout_s,
        _operation,
    )
    if not payload:
        raise ValueError(f"CoinGecko returned no market row for {symbol}")
    item = payload[0]
    source_timestamp = _parse_datetime(item.get("last_updated"), fallback=fetched_at)
    excerpt = CoinGeckoPayloadExcerpt(
        priceUsd=float(item.get("current_price") or 0.0),
        change24hPct=float(item.get("price_change_percentage_24h_in_currency") or 0.0),
        volume24hUsd=float(item.get("total_volume") or 0.0),
        marketCapRank=(
            int(item["market_cap_rank"])
            if item.get("market_cap_rank") is not None
            else None
        ),
    )
    snapshot = CoinGeckoMarketSnapshot(
        symbol=symbol,
        price_usd=float(item.get("current_price") or 0.0),
        change_24h_pct=float(item.get("price_change_percentage_24h_in_currency") or 0.0),
        volume_24h_usd=float(item.get("total_volume") or 0.0),
        market_cap_rank=(
            int(item["market_cap_rank"])
            if item.get("market_cap_rank") is not None
            else None
        ),
        source_timestamp=source_timestamp,
        fetched_at=fetched_at,
        http_status=response.status_code,
        latency_ms=latency_ms,
        retry_count=retry_count,
        timeout_ms=timeout_ms,
        payload_hash=_payload_hash(payload),
        payload_excerpt=excerpt,
    )
    adapter_logger.info(
        "Sentiment source fetch succeeded"
        " | source=coingecko"
        f" | symbol={snapshot.symbol}"
        f" | price_usd={snapshot.price_usd:.4f}"
        f" | change_24h_pct={snapshot.change_24h_pct:.4f}"
        f" | volume_24h_usd={snapshot.volume_24h_usd:.2f}"
        f" | latency_ms={snapshot.latency_ms}"
        f" | retry_count={snapshot.retry_count}"
        f" | freshness_sec={snapshot.freshness_sec}"
        f" | http_status={snapshot.http_status}"
    )
    return snapshot


async def fetch_binance_market_snapshot(
    symbol: str, *, client: httpx.AsyncClient | None = None
) -> BinanceMarketSnapshot:
    settings = get_settings()
    timeout_s = _effective_timeout_s(
        settings.binance_timeout_s or settings.sentiment_source_timeout_s
    )
    market_symbol = SYMBOL_TO_BINANCE_MARKET[symbol]
    async def _operation() -> tuple[httpx.Response, httpx.Response, dict[str, Any], list[list[Any]], datetime]:
        async def _execute(
            current_client: httpx.AsyncClient,
        ) -> tuple[httpx.Response, httpx.Response, dict[str, Any], list[list[Any]], datetime]:
            fetched_at = _now_utc()
            ticker_response, kline_response = await asyncio.gather(
                current_client.get(
                    "/api/v3/ticker/24hr",
                    params={"symbol": market_symbol},
                    timeout=timeout_s,
                ),
                current_client.get(
                    "/api/v3/klines",
                    params={"symbol": market_symbol, "interval": "5m", "limit": 12},
                    timeout=timeout_s,
                ),
            )
            ticker_response.raise_for_status()
            kline_response.raise_for_status()
            return (
                ticker_response,
                kline_response,
                _parse_json_response(ticker_response, source_name="binance_market_data ticker"),
                _parse_json_response(kline_response, source_name="binance_market_data klines"),
                fetched_at,
            )

        return await _run_with_adapter_client(
            source_name="binance_market_data",
            base_url=settings.binance_base_url,
            timeout_s=timeout_s,
            client=client,
            operation=_execute,
        )

    (
        ticker_response,
        _kline_response,
        ticker_payload,
        kline_payload,
        fetched_at,
    ), retry_count, latency_ms, timeout_ms = await _run_with_retry(
        "binance_market_data",
        timeout_s,
        _operation,
    )
    if not isinstance(kline_payload, list) or len(kline_payload) < 2:
        raise ValueError(f"Binance returned insufficient klines for {symbol}")

    close_prices = [float(row[4]) for row in kline_payload]
    source_timestamp = datetime.fromtimestamp(int(kline_payload[-1][6]) / 1000, tz=UTC)
    excerpt = BinancePayloadExcerpt(
        marketSymbol=market_symbol,
        lastPriceUsd=float(ticker_payload.get("lastPrice") or 0.0),
        priceChangePct=float(ticker_payload.get("priceChangePercent") or 0.0),
        quoteVolumeUsd=float(ticker_payload.get("quoteVolume") or 0.0),
        klineCount=len(kline_payload),
    )
    snapshot = BinanceMarketSnapshot(
        symbol=symbol,
        market_symbol=market_symbol,
        last_price_usd=float(ticker_payload.get("lastPrice") or 0.0),
        price_change_pct=float(ticker_payload.get("priceChangePercent") or 0.0),
        quote_volume_usd=float(ticker_payload.get("quoteVolume") or 0.0),
        realized_volatility_pct=_realized_volatility_pct(close_prices),
        source_timestamp=source_timestamp,
        fetched_at=fetched_at,
        http_status=ticker_response.status_code,
        latency_ms=latency_ms,
        retry_count=retry_count,
        timeout_ms=timeout_ms,
        payload_hash=_payload_hash({"ticker": ticker_payload, "klines": kline_payload}),
        payload_excerpt=excerpt,
    )
    adapter_logger.info(
        "Sentiment source fetch succeeded"
        " | source=binance_market_data"
        f" | symbol={snapshot.symbol}"
        f" | market_symbol={snapshot.market_symbol}"
        f" | last_price_usd={snapshot.last_price_usd:.4f}"
        f" | change_pct={snapshot.price_change_pct:.4f}"
        f" | realized_volatility_pct={snapshot.realized_volatility_pct:.4f}"
        f" | latency_ms={snapshot.latency_ms}"
        f" | retry_count={snapshot.retry_count}"
        f" | freshness_sec={snapshot.freshness_sec}"
        f" | http_status={snapshot.http_status}"
    )
    return snapshot