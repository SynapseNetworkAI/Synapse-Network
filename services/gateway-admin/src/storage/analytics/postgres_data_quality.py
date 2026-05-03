from typing import Any

from src.storage.analytics.analytics_dashboard import CRITICAL_EVENTS, _rate

DUPLICATE_RATE_WARNING = 0.01
RAW_WALLET_ADDRESS_LENGTH = 42


def _prop(event: dict[str, Any], key: str) -> Any:
    props = event.get("properties") or {}
    return props.get(key) if isinstance(props, dict) else None


def _prop_str(event: dict[str, Any], key: str, fallback: str = "") -> str:
    value = _prop(event, key)
    return str(value if value not in (None, "") else fallback)


def _has_prop(event: dict[str, Any], key: str) -> bool:
    props = event.get("properties") or {}
    return isinstance(props, dict) and key in props and props[key] not in (None, "")


def _events_named(events: list[dict[str, Any]], *names: str) -> list[dict[str, Any]]:
    expected = set(names)
    return [event for event in events if event.get("event_name") in expected]


def _privacy_violation_count(events: list[dict[str, Any]]) -> int:
    return sum(1 for event in events if _has_privacy_violation(event))


def _has_privacy_violation(event: dict[str, Any]) -> bool:
    distinct_id = str(event.get("distinct_id") or "")
    if distinct_id.startswith("0x") or len(distinct_id) == RAW_WALLET_ADDRESS_LENGTH:
        return True
    return _has_wallet_like_property(event)


def _has_wallet_like_property(event: dict[str, Any]) -> bool:
    keys = ("wallet_address", "owner_address", "consumer_wallet", "provider_wallet", "from_address", "to_address")
    return any(str(_prop(event, key) or "").startswith("0x") for key in keys)


def _missing_required_counts(events: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "invoke_completed": _missing_required_count(events, "invoke_completed", ("service_id", "provider_id", "price_usdc")),
        "invoke_failed": _missing_required_count(events, "invoke_failed", ("error_code", "failure_stage")),
        "deposit_completed": _missing_required_count(events, "deposit_completed", ("amount_usdc", "time_to_confirm_ms")),
    }


def _missing_required_count(events: list[dict[str, Any]], event_name: str, keys: tuple[str, ...]) -> int:
    return sum(1 for event in _events_named(events, event_name) if not _has_all_props(event, keys))


def _has_all_props(event: dict[str, Any], keys: tuple[str, ...]) -> bool:
    return all(_has_prop(event, key) for key in keys)


def _source_coverage(events: list[dict[str, Any]]) -> dict[str, int]:
    source_coverage: dict[str, int] = {}
    for event in events:
        source = str(event.get("source") or "unknown")
        source_coverage[source] = source_coverage.get(source, 0) + 1
    return source_coverage


def _critical_freshness(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    freshness = []
    for event_name in CRITICAL_EVENTS:
        rows = _events_named(events, event_name)
        last_seen = max((str(row.get("timestamp") or "") for row in rows), default="")
        freshness.append({"eventName": event_name, "seen": bool(rows), "lastSeenAt": last_seen, "count": len(rows)})
    return freshness


def _xor_violation_count(events: list[dict[str, Any]]) -> int:
    correlation: dict[str, dict[str, int]] = {}
    for event in _events_named(events, "invoke_completed", "invoke_failed"):
        _track_invoke_correlation(correlation, event)
    return sum(1 for item in correlation.values() if item["completed"] > 0 and item["failed"] > 0)


def _track_invoke_correlation(correlation: dict[str, dict[str, int]], event: dict[str, Any]) -> None:
    correlation_id = _prop_str(event, "request_id") or _prop_str(event, "quote_id")
    if not correlation_id:
        return
    item = correlation.setdefault(correlation_id, {"completed": 0, "failed": 0})
    key = "completed" if event.get("event_name") == "invoke_completed" else "failed"
    item[key] += 1


def _file_backend_fallback_count(events: list[dict[str, Any]]) -> int:
    return sum(1 for event in events if _is_file_backend_event(event))


def _is_file_backend_event(event: dict[str, Any]) -> bool:
    return str(event.get("source") or "") in {"file", "file_backend"} or _prop_str(event, "backend") == "file"


def _quality_status(
    source_status: str,
    event_count: int,
    duplicate_rate: float,
    critical_freshness: list[dict[str, Any]],
    privacy_violations: int,
    missing_required: int,
    xor_violations: int,
    file_backend_fallback_events: int,
) -> str:
    if source_status != "healthy" or event_count == 0 or any(not item["seen"] for item in critical_freshness) or privacy_violations > 0 or xor_violations > 0:
        return "degraded"
    if duplicate_rate > DUPLICATE_RATE_WARNING or missing_required > 0 or file_backend_fallback_events > 0:
        return "monitoring"
    return "nominal"


def _schema_issue_samples(missing_counts: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {"eventName": "invoke_completed", "issue": "missing required properties", "count": missing_counts["invoke_completed"]},
        {"eventName": "invoke_failed", "issue": "missing required properties", "count": missing_counts["invoke_failed"]},
        {"eventName": "deposit_completed", "issue": "missing required properties", "count": missing_counts["deposit_completed"]},
    ]


def build_data_quality(window: str, source_status: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    event_count = len(events)
    unique_event_ids = len({str(event.get("event_id") or "") for event in events if event.get("event_id")})
    duplicate_count = max(event_count - unique_event_ids, 0)
    duplicate_rate = _rate(duplicate_count, event_count)
    missing_counts = _missing_required_counts(events)
    missing_required = sum(missing_counts.values())
    critical_freshness = _critical_freshness(events)
    privacy_violations = _privacy_violation_count(events)
    xor_violations = _xor_violation_count(events)
    file_backend_fallback_events = _file_backend_fallback_count(events)
    overall_status = _quality_status(source_status, event_count, duplicate_rate, critical_freshness, privacy_violations, missing_required, xor_violations, file_backend_fallback_events)
    return {
        "window": window,
        "overallStatus": overall_status,
        "eventCount": event_count,
        "duplicateRate": duplicate_rate,
        "criticalEventsFreshness": critical_freshness,
        "sourceCoverage": _source_coverage(events),
        "privacyViolations": privacy_violations,
        "missingRequiredProperties": missing_required,
        "xorViolations": xor_violations,
        "kafkaLag": 0,
        "clickhouseLag": 0,
        "fileBackendFallbackEvents": file_backend_fallback_events,
        "schemaIssueSamples": _schema_issue_samples(missing_counts),
    }
