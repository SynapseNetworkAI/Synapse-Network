from __future__ import annotations

import asyncio
import hashlib
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings


_ALLOWED_X_MEDIA_HOST_SUFFIXES = (".twimg.com",)
_TOKEN_CACHE: dict[str, str] = {}
_TOKEN_CACHE_LOCK = asyncio.Lock()


@dataclass(frozen=True)
class ResolvedTwitterVideo:
    tweet_id: str
    variant_url: str
    duration_sec: int | None
    width: int | None
    height: int | None
    mime_type: str
    preview_image_url: str | None = None


def extract_tweet_id(post_url: str) -> str:
    parsed = urlparse(post_url)
    segments = [segment for segment in parsed.path.split("/") if segment]
    for index, segment in enumerate(segments):
        if segment == "status" and index + 1 < len(segments):
            tweet_id = segments[index + 1].strip()
            if tweet_id:
                return tweet_id
    raise ValueError("TWEET_NOT_FOUND")


def _is_trusted_x_media_url(value: str) -> bool:
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        return False
    if parsed.username or parsed.password:
        return False
    if parsed.port not in (None, 443):
        return False
    host = parsed.netloc.lower()
    return host.endswith(_ALLOWED_X_MEDIA_HOST_SUFFIXES)


def _normalize_x_media_url(value: str) -> str:
    normalized = str(value or "").strip()
    if not _is_trusted_x_media_url(normalized):
        raise ValueError("VIDEO_NOT_FOUND_IN_POST")
    return normalized


def _cache_key(api_key: str, api_secret: str) -> str:
    return hashlib.sha256(f"{api_key}:{api_secret}".encode("utf-8")).hexdigest()


@asynccontextmanager
async def x_api_client(client: httpx.AsyncClient | None = None):
    if client is not None:
        yield client
        return

    settings = get_settings()
    async with httpx.AsyncClient(
        base_url=settings.twitter_x_api_base_url.rstrip("/"),
        follow_redirects=True,
        timeout=settings.twitter_x_api_timeout_s,
        headers={"User-Agent": settings.twitter_x_api_user_agent},
    ) as built:
        yield built


async def resolve_x_app_bearer_token(*, client: httpx.AsyncClient | None = None) -> str:
    settings = get_settings()
    configured_bearer = str(settings.twitter_x_api_bearer_token or "").strip()
    if configured_bearer:
        return configured_bearer

    api_key = str(settings.twitter_x_api_key or "").strip()
    api_secret = str(settings.twitter_x_api_secret or "").strip()
    if not api_key or not api_secret:
        raise ValueError("TWITTER_X_API_CREDENTIALS_MISSING")

    token_cache_key = _cache_key(api_key, api_secret)
    cached_token = _TOKEN_CACHE.get(token_cache_key)
    if cached_token:
        return cached_token

    async with _TOKEN_CACHE_LOCK:
        cached_token = _TOKEN_CACHE.get(token_cache_key)
        if cached_token:
            return cached_token

        async with x_api_client(client) as current_client:
            response = await current_client.post(
                "/oauth2/token",
                data={"grant_type": "client_credentials"},
                auth=(api_key, api_secret),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if response.status_code == 429:
                raise ValueError("TWITTER_X_API_RATE_LIMITED")
            if response.status_code in {401, 403}:
                raise ValueError("TWITTER_X_API_AUTH_FAILED")
            try:
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise ValueError("TWITTER_X_API_AUTH_FAILED") from exc
            payload = response.json()
            token_type = str(payload.get("token_type") or "").strip().lower()
            access_token = str(payload.get("access_token") or "").strip()
            if token_type != "bearer" or not access_token:
                raise ValueError("TWITTER_X_API_AUTH_FAILED")
            _TOKEN_CACHE[token_cache_key] = access_token
            return access_token


def _select_mp4_variant(
    variants: list[dict[str, Any]],
    *,
    preferred_quality: str,
) -> tuple[str, str]:
    mp4_variants = [
        variant for variant in variants
        if str(variant.get("content_type") or "").lower() == "video/mp4"
        and str(variant.get("url") or "").strip()
    ]
    if not mp4_variants:
        raise ValueError("VIDEO_NOT_FOUND_IN_POST")

    ordered_variants = sorted(mp4_variants, key=lambda item: int(item.get("bit_rate") or 0))
    if preferred_quality == "low":
        selected = ordered_variants[0]
    elif preferred_quality == "medium":
        selected = ordered_variants[len(ordered_variants) // 2]
    else:
        selected = ordered_variants[-1]
    return _normalize_x_media_url(str(selected.get("url") or "")), str(selected.get("content_type") or "video/mp4")


def _select_media_entry(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data") or {}
    media_entries = list(((payload.get("includes") or {}).get("media")) or [])
    if not media_entries:
        raise ValueError("VIDEO_NOT_FOUND_IN_POST")

    attachments = (data.get("attachments") or {}).get("media_keys") or []
    media_by_key = {
        str(entry.get("media_key") or ""): entry
        for entry in media_entries
        if isinstance(entry, dict)
    }
    ordered_candidates = [media_by_key[key] for key in attachments if key in media_by_key]
    ordered_candidates.extend(
        entry for entry in media_entries
        if isinstance(entry, dict) and entry not in ordered_candidates
    )

    for entry in ordered_candidates:
        media_type = str(entry.get("type") or "").strip().lower()
        if media_type in {"video", "animated_gif"} and list(entry.get("variants") or []):
            return entry
    raise ValueError("VIDEO_NOT_FOUND_IN_POST")


async def resolve_twitter_video_from_x_api(
    post_url: str,
    *,
    preferred_quality: str,
    client: httpx.AsyncClient | None = None,
) -> ResolvedTwitterVideo:
    tweet_id = extract_tweet_id(post_url)
    bearer_token = await resolve_x_app_bearer_token(client=client)
    params = {
        "expansions": "attachments.media_keys",
        "tweet.fields": "attachments",
        "media.fields": "duration_ms,height,media_key,preview_image_url,type,url,variants,width",
    }

    async with x_api_client(client) as current_client:
        response = await current_client.get(
            f"/2/tweets/{tweet_id}",
            params=params,
            headers={"Authorization": f"Bearer {bearer_token}"},
        )
        if response.status_code == 404:
            raise ValueError("TWEET_NOT_FOUND")
        if response.status_code == 429:
            raise ValueError("TWITTER_X_API_RATE_LIMITED")
        if response.status_code in {401, 403}:
            raise ValueError("TWITTER_X_API_AUTH_FAILED")
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError("TWITTER_X_API_LOOKUP_FAILED") from exc

        payload = response.json()
        media_entry = _select_media_entry(payload)
        variant_url, mime_type = _select_mp4_variant(
            list(media_entry.get("variants") or []),
            preferred_quality=preferred_quality,
        )
        preview_image_url = None
        raw_preview_image_url = str(media_entry.get("preview_image_url") or "").strip()
        if raw_preview_image_url:
            preview_image_url = _normalize_x_media_url(raw_preview_image_url)
        duration_ms = media_entry.get("duration_ms")
        duration_sec = (
            max(1, int(round(float(duration_ms) / 1000)))
            if isinstance(duration_ms, (int, float)) and duration_ms > 0
            else None
        )
        width = int(media_entry["width"]) if isinstance(media_entry.get("width"), (int, float)) else None
        height = int(media_entry["height"]) if isinstance(media_entry.get("height"), (int, float)) else None
        return ResolvedTwitterVideo(
            tweet_id=tweet_id,
            variant_url=variant_url,
            duration_sec=duration_sec,
            width=width,
            height=height,
            mime_type=mime_type or "video/mp4",
            preview_image_url=preview_image_url,
        )
