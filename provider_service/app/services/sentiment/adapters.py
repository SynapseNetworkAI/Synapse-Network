from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import json
import math
from statistics import pstdev
import time
from typing import Any, Awaitable, Callable, TypeVar

import httpx

from app.core.config import get_settings


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
    payload_excerpt: dict[str, Any]

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
    payload_excerpt: dict[str, Any]

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
    payload_excerpt: dict[str, Any]

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
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == max_attempts:
                raise RuntimeError(
                    f"{source_name} fetch failed after {max_attempts} attempts: {exc}"
                ) from exc
            await asyncio.sleep((backoff_ms * attempt) / 1000)

    raise RuntimeError(f"{source_name} fetch failed: {last_error}")


async def fetch_alternative_me_sentiment(
    *, client: httpx.AsyncClient | None = None
) -> AlternativeMeSentimentSnapshot:
    settings = get_settings()
    timeout_s = settings.alternative_me_timeout_s or settings.sentiment_source_timeout_s
    close_client = client is None
    current_client = client or httpx.AsyncClient(
        base_url=settings.alternative_me_base_url,
        timeout=timeout_s,
    )
    try:
        async def _operation() -> tuple[httpx.Response, dict[str, Any], datetime]:
            fetched_at = _now_utc()
            response = await current_client.get(
                "/fng/",
                params={"limit": 1, "format": "json"},
                timeout=timeout_s,
            )
            response.raise_for_status()
            return response, response.json(), fetched_at

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
        excerpt = {
            "value": value,
            "classification": classification,
            "timestamp": item["timestamp"],
        }
        return AlternativeMeSentimentSnapshot(
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
    finally:
        if close_client:
            await current_client.aclose()


async def fetch_coingecko_market_snapshot(
    symbol: str, *, client: httpx.AsyncClient | None = None
) -> CoinGeckoMarketSnapshot:
    settings = get_settings()
    timeout_s = settings.coingecko_timeout_s or settings.sentiment_source_timeout_s
    coin_id = SYMBOL_TO_COINGECKO_ID[symbol]
    close_client = client is None
    current_client = client or httpx.AsyncClient(
        base_url=settings.coingecko_base_url,
        timeout=timeout_s,
    )
    try:
        async def _operation() -> tuple[httpx.Response, list[dict[str, Any]], datetime]:
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
            return response, response.json(), fetched_at

        (response, payload, fetched_at), retry_count, latency_ms, timeout_ms = await _run_with_retry(
            "coingecko",
            timeout_s,
            _operation,
        )
        if not payload:
            raise ValueError(f"CoinGecko returned no market row for {symbol}")
        item = payload[0]
        source_timestamp = _parse_datetime(item.get("last_updated"), fallback=fetched_at)
        excerpt = {
            "priceUsd": float(item.get("current_price") or 0.0),
            "change24hPct": float(item.get("price_change_percentage_24h_in_currency") or 0.0),
            "volume24hUsd": float(item.get("total_volume") or 0.0),
            "marketCapRank": item.get("market_cap_rank"),
        }
        return CoinGeckoMarketSnapshot(
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
    finally:
        if close_client:
            await current_client.aclose()


async def fetch_binance_market_snapshot(
    symbol: str, *, client: httpx.AsyncClient | None = None
) -> BinanceMarketSnapshot:
    settings = get_settings()
    timeout_s = settings.binance_timeout_s or settings.sentiment_source_timeout_s
    market_symbol = SYMBOL_TO_BINANCE_MARKET[symbol]
    close_client = client is None
    current_client = client or httpx.AsyncClient(
        base_url=settings.binance_base_url,
        timeout=timeout_s,
    )
    try:
        async def _operation() -> tuple[httpx.Response, httpx.Response, dict[str, Any], list[list[Any]], datetime]:
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
                ticker_response.json(),
                kline_response.json(),
                fetched_at,
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
        excerpt = {
            "marketSymbol": market_symbol,
            "lastPriceUsd": float(ticker_payload.get("lastPrice") or 0.0),
            "priceChangePct": float(ticker_payload.get("priceChangePercent") or 0.0),
            "quoteVolumeUsd": float(ticker_payload.get("quoteVolume") or 0.0),
            "klineCount": len(kline_payload),
        }
        return BinanceMarketSnapshot(
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
    finally:
        if close_client:
            await current_client.aclose()