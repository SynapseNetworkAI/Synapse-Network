from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from time import perf_counter
from typing import Any

from fastapi import HTTPException

from app.schemas.sentiment import ErrorRecord
from app.services.smart_contract_audit.domain import ProviderInvocationRecord


@dataclass(frozen=True)
class DownloadExecutionContext:
    service_id: str
    request_id: str | None
    gateway_request_id: str | None
    input_payload: dict[str, Any]
    asset_key: str
    fallback_error_code: str
    fallback_error_message: str
    default_error_code: str


async def execute_download_with_repository(
    *,
    context: DownloadExecutionContext,
    repository: Any,
    run_live_download: Callable[[], Awaitable[tuple[Any, dict[str, Any]]]],
    build_record: Callable[[Any], Any],
    now_utc: Callable[[], datetime],
) -> Any:
    start = perf_counter()
    try:
        response, observability_payload = await run_live_download()
        repository.save_asset(build_record(response))
        repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=context.service_id,
                input_payload=context.input_payload,
                response_status=200,
                request_id=context.request_id,
                gateway_request_id=context.gateway_request_id,
                error_code=None,
                upstream_status=None,
                latency_ms=int((perf_counter() - start) * 1000),
                cache_hit=False,
                observability_payload=observability_payload,
            )
        )
        return response
    except ValueError as exc:
        message = str(exc)
        code = message if message.isupper() else context.default_error_code
    except Exception as exc:  # noqa: BLE001
        code = context.default_error_code
        message = str(exc)

    snapshot = repository.load_asset(context.asset_key)
    if snapshot is not None and not snapshot.is_expired(now=now_utc()):
        replay = snapshot.as_cache_hit_response().model_copy(
            update={
                "errors": [
                    *snapshot.response.errors,
                    ErrorRecord(
                        code=context.fallback_error_code,
                        message=context.fallback_error_message,
                    ),
                ]
            }
        )
        repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=context.service_id,
                input_payload=context.input_payload,
                response_status=200,
                request_id=context.request_id,
                gateway_request_id=context.gateway_request_id,
                error_code=code,
                upstream_status=None,
                latency_ms=int((perf_counter() - start) * 1000),
                cache_hit=True,
                observability_payload={"assetKey": context.asset_key, "fallbackReason": message},
            )
        )
        return replay

    raise HTTPException(status_code=502, detail={"code": code, "message": message})
