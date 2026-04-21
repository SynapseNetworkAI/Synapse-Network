from __future__ import annotations

import hmac
import base64
import logging
import re
import threading
import time
from collections import Counter
from collections.abc import Mapping

from fastapi import Request, Response, status


logger = logging.getLogger(__name__)

MAX_LABEL_VALUE_LENGTH = 40
_SENSITIVE_VALUE_PATTERNS = (
    re.compile(r"0x[a-fA-F0-9]{40,}"),
    re.compile(r"(?i)bearer\s+[a-z0-9._\-]+"),
    re.compile(r"(?i)(token|secret|signature|private[_-]?key|password)"),
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
)


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _labels_to_text(labels: Mapping[str, str]) -> str:
    if not labels:
        return ""
    rendered = ",".join(
        f'{key}="{_escape_label(value)}"' for key, value in sorted(labels.items())
    )
    return "{" + rendered + "}"


def _safe_label_value(value: object) -> str | None:
    text = str(value)
    if len(text) > MAX_LABEL_VALUE_LENGTH:
        return None
    if any(pattern.search(text) for pattern in _SENSITIVE_VALUE_PATTERNS):
        return None
    return text


def _compact_route(route: object) -> str:
    text = str(route or "unknown")
    if len(text) <= MAX_LABEL_VALUE_LENGTH:
        return text
    return "long_route"


class MetricsRegistry:
    def __init__(self, *, service: str) -> None:
        self._service = service
        self._lock = threading.Lock()
        self._start_time = time.time()
        self._http_counts: Counter[tuple[str, str, str]] = Counter()
        self._http_duration_sum: Counter[tuple[str, str, str]] = Counter()
        self._label_rejections: Counter[str] = Counter()
        self._gauges: dict[str, tuple[dict[str, str], float]] = {}

    def observe_http(
        self,
        *,
        method: str,
        route: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        labels = {
            "service": self._service,
            "method": method.upper(),
            "route": _compact_route(route),
            "status_class": f"{int(status_code / 100)}xx",
        }
        safe = self._validated_labels(labels)
        if safe is None:
            return
        key = (safe["method"], safe["route"], safe["status_class"])
        with self._lock:
            self._http_counts[key] += 1
            self._http_duration_sum[key] += max(0.0, duration_seconds)

    def set_gauge(self, name: str, value: float, labels: Mapping[str, object]) -> None:
        safe = self._validated_labels({"service": self._service, **dict(labels)})
        if safe is None:
            return
        with self._lock:
            self._gauges[name] = (safe, float(value))

    def _validated_labels(self, labels: Mapping[str, object]) -> dict[str, str] | None:
        safe: dict[str, str] = {}
        for key, value in labels.items():
            label_value = _safe_label_value(value)
            if label_value is None:
                reason = f"{key}_rejected"
                self._reject_label(reason, key, value)
                return None
            safe[key] = label_value
        return safe

    def _reject_label(self, reason: str, key: str, value: object) -> None:
        with self._lock:
            self._label_rejections[reason] += 1
        logger.error(
            "METRIC_LABEL_REJECTED",
            extra={
                "metric_label": key,
                "reason": reason,
                "value_length": len(str(value)),
            },
        )

    def render(self) -> str:
        lines: list[str] = [
            "# HELP synapse_process_start_time_seconds Process start timestamp.",
            "# TYPE synapse_process_start_time_seconds gauge",
            f'synapse_process_start_time_seconds{_labels_to_text({"service": self._service})} {self._start_time:.0f}',
            "# HELP synapse_http_requests_total HTTP requests by route and status class.",
            "# TYPE synapse_http_requests_total counter",
        ]
        with self._lock:
            for (method, route, status_class), count in sorted(self._http_counts.items()):
                labels = {
                    "service": self._service,
                    "method": method,
                    "route": route,
                    "status_class": status_class,
                }
                lines.append(
                    f"synapse_http_requests_total{_labels_to_text(labels)} {count}"
                )
            lines.extend(
                [
                    "# HELP synapse_http_request_duration_seconds_sum Total HTTP request duration.",
                    "# TYPE synapse_http_request_duration_seconds_sum counter",
                ]
            )
            for (method, route, status_class), duration in sorted(
                self._http_duration_sum.items()
            ):
                labels = {
                    "service": self._service,
                    "method": method,
                    "route": route,
                    "status_class": status_class,
                }
                lines.append(
                    f"synapse_http_request_duration_seconds_sum{_labels_to_text(labels)} {float(duration):.6f}"
                )
            lines.extend(
                [
                    "# HELP synapse_metric_label_rejected_total Dropped metrics due to unsafe or high-cardinality labels.",
                    "# TYPE synapse_metric_label_rejected_total counter",
                ]
            )
            for reason, count in sorted(self._label_rejections.items()):
                labels = {"service": self._service, "reason": reason}
                lines.append(
                    f"synapse_metric_label_rejected_total{_labels_to_text(labels)} {count}"
                )
            for name, (labels, value) in sorted(self._gauges.items()):
                lines.append(f"# TYPE {name} gauge")
                lines.append(f"{name}{_labels_to_text(labels)} {value}")
        return "\n".join(lines) + "\n"


def metrics_authorized(
    request: Request,
    *,
    bearer_token: str,
    basic_username: str = "",
    basic_password: str = "",
) -> bool:
    auth_header = request.headers.get("Authorization", "")
    if bearer_token:
        expected = f"Bearer {bearer_token}"
        if hmac.compare_digest(auth_header, expected):
            return True
    if basic_username and basic_password and auth_header.startswith("Basic "):
        try:
            decoded = base64.b64decode(auth_header.removeprefix("Basic ")).decode()
        except Exception:
            return False
        expected = f"{basic_username}:{basic_password}"
        return hmac.compare_digest(decoded, expected)
    return False


def observe_request_metrics(
    registry: MetricsRegistry,
    *,
    request: Request,
    started_at: float,
    status_code: int,
) -> None:
    route = getattr(request.scope.get("route"), "path", request.url.path)
    registry.observe_http(
        method=request.method,
        route=route,
        status_code=status_code,
        duration_seconds=time.perf_counter() - started_at,
    )


def metrics_response(
    request: Request,
    registry: MetricsRegistry,
    *,
    bearer_token: str,
    basic_username: str = "",
    basic_password: str = "",
) -> Response:
    if not (bearer_token or (basic_username and basic_password)):
        return Response(
            "metrics_not_configured\n",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            media_type="text/plain; version=0.0.4",
        )
    if not metrics_authorized(
        request,
        bearer_token=bearer_token,
        basic_username=basic_username,
        basic_password=basic_password,
    ):
        return Response(
            "metrics_forbidden\n",
            status_code=status.HTTP_403_FORBIDDEN,
            media_type="text/plain; version=0.0.4",
        )
    return Response(registry.render(), media_type="text/plain; version=0.0.4")
