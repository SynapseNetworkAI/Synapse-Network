from __future__ import annotations

import re


_NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")

_PROTOCOL_ALIASES = {
    "aave": "Aave",
    "aave protocol": "Aave",
    "uni": "Uniswap",
    "uniswap": "Uniswap",
    "uniswap protocol": "Uniswap",
    "lido": "Lido",
    "lido finance": "Lido",
    "makerdao": "Maker",
    "maker": "Maker",
    "sky": "Maker",
    "rocketpool": "Rocket Pool",
    "rocket pool": "Rocket Pool",
    "compound": "Compound",
    "compound finance": "Compound",
    "morpho": "Morpho",
}

_DEFILLAMA_PROTOCOL_SLUGS = {
    "aave": "aave-v3",
    "aave protocol": "aave-v3",
    "uni": "uniswap",
    "uniswap": "uniswap",
    "uniswap protocol": "uniswap",
    "lido": "lido",
    "lido finance": "lido",
    "makerdao": "sky-lending",
    "maker": "sky-lending",
    "sky": "sky-lending",
    "rocketpool": "rocket-pool",
    "rocket pool": "rocket-pool",
    "compound": "compound-v3",
    "compound finance": "compound-v3",
    "morpho": "morpho-v1",
}


def protocol_alias_key(value: str | None) -> str:
    normalized = _NORMALIZE_PATTERN.sub(" ", str(value or "").strip().lower())
    return " ".join(normalized.split())


def normalize_protocol_query(value: str | None) -> str:
    raw_value = str(value or "").strip()
    if not raw_value:
        return ""
    alias_key = protocol_alias_key(raw_value)
    return _PROTOCOL_ALIASES.get(alias_key, raw_value)


def canonical_defillama_slug(value: str | None) -> str | None:
    alias_key = protocol_alias_key(value)
    if not alias_key:
        return None
    return _DEFILLAMA_PROTOCOL_SLUGS.get(alias_key)