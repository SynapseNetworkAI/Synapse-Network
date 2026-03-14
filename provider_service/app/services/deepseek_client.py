import json
import asyncio
from pathlib import Path
from threading import Lock


QUOTE_SOURCE = "local_json"
QUOTE_MODEL = "local-json-100"
_QUOTE_FILE = Path(__file__).resolve().parents[1] / "data" / "famous_quotes_100.json"
_quote_cache: list[str] | None = None
_quote_index = 0
_quote_lock = Lock()


def _load_quotes() -> list[str]:
    global _quote_cache
    if _quote_cache is not None:
        return _quote_cache

    if not _QUOTE_FILE.exists():
        raise RuntimeError(f"Quote dataset not found: {_QUOTE_FILE}")

    try:
        data = json.loads(_QUOTE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError("Invalid quote dataset JSON format") from error

    if not isinstance(data, list):
        raise RuntimeError("Quote dataset must be a JSON array")

    quotes = [str(item).strip() for item in data if str(item).strip()]
    if len(quotes) < 100:
        raise RuntimeError("Quote dataset must contain at least 100 non-empty quotes")

    _quote_cache = quotes
    return _quote_cache


def _next_quote() -> str:
    global _quote_index
    quotes = _load_quotes()
    with _quote_lock:
        quote = quotes[_quote_index % len(quotes)]
        _quote_index += 1
    return quote


async def request_famous_quote(text: str) -> str:
    await asyncio.sleep(0)
    _ = text
    return _next_quote()


async def request_famous_quote_top3(text: str) -> list[str]:
    await asyncio.sleep(0)
    _ = text
    # Keep API compatibility for /top3 while sourcing data locally.
    return [_next_quote(), _next_quote(), _next_quote()]
