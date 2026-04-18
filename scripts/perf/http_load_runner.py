#!/usr/bin/env python3
"""Small dependency-free HTTP load runner for staging evidence collection.

This runner intentionally stays generic. It produces latency and status-code
summaries, but it does not decide production readiness by itself. The release
owner must attach reconciliation, logs, dashboards, and threshold analysis.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import random
import statistics
import string
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def _render(value: Any) -> Any:
    if isinstance(value, str):
        template = string.Template(value)
        return template.safe_substitute(os.environ)
    if isinstance(value, list):
        return [_render(item) for item in value]
    if isinstance(value, dict):
        return {key: _render(item) for key, item in value.items()}
    return value


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = int(round((len(ordered) - 1) * percentile))
    return ordered[max(0, min(index, len(ordered) - 1))]


def _request(base_url: str, spec: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
    spec = _render_runtime_tokens(spec)
    method = str(spec.get("method") or "GET").upper()
    path = str(spec.get("path") or "/")
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    headers = {str(k): str(v) for k, v in dict(spec.get("headers") or {}).items()}
    body = spec.get("body")
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")

    started = time.perf_counter()
    status = 0
    error = ""
    try:
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            status = int(response.status)
            response.read()
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        error = str(exc)
    except Exception as exc:  # noqa: BLE001 - load evidence must retain failures
        error = str(exc)
    latency_ms = (time.perf_counter() - started) * 1000.0
    expected = set(int(item) for item in spec.get("expectedStatuses") or [200])
    return {
        "name": str(spec.get("name") or path),
        "status": status,
        "ok": status in expected,
        "latencyMs": latency_ms,
        "error": error,
    }


def _render_runtime_tokens(value: Any) -> Any:
    if isinstance(value, str):
        return value.replace("{{random}}", f"{random.getrandbits(64):016x}")
    if isinstance(value, list):
        return [_render_runtime_tokens(item) for item in value]
    if isinstance(value, dict):
        return {key: _render_runtime_tokens(item) for key, item in value.items()}
    return value


def _run_worker(
    *,
    base_url: str,
    requests: list[dict[str, Any]],
    deadline: float,
    timeout_sec: float,
    request_delay_sec: float,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    weights = [max(1, int(item.get("weight") or 1)) for item in requests]
    while time.perf_counter() < deadline:
        spec = random.choices(requests, weights=weights, k=1)[0]
        results.append(_request(base_url, spec, timeout_sec))
        if request_delay_sec > 0:
            time.sleep(request_delay_sec)
    return results


def _summarize(results: list[dict[str, Any]], duration_sec: int, concurrency: int) -> dict[str, Any]:
    by_name: dict[str, list[dict[str, Any]]] = {}
    for row in results:
        by_name.setdefault(str(row["name"]), []).append(row)

    endpoints: dict[str, Any] = {}
    for name, rows in sorted(by_name.items()):
        latencies = [float(row["latencyMs"]) for row in rows]
        errors = [row for row in rows if not bool(row["ok"])]
        statuses: dict[str, int] = {}
        for row in rows:
            statuses[str(row["status"])] = statuses.get(str(row["status"]), 0) + 1
        endpoints[name] = {
            "requests": len(rows),
            "successes": len(rows) - len(errors),
            "failures": len(errors),
            "successRate": 0.0 if not rows else (len(rows) - len(errors)) / len(rows),
            "p50Ms": round(_percentile(latencies, 0.50), 3),
            "p95Ms": round(_percentile(latencies, 0.95), 3),
            "p99Ms": round(_percentile(latencies, 0.99), 3),
            "avgMs": round(statistics.fmean(latencies), 3) if latencies else 0.0,
            "statuses": statuses,
            "sampleErrors": [row["error"] for row in errors[:5] if row.get("error")],
        }

    failures = [row for row in results if not bool(row["ok"])]
    return {
        "durationSec": duration_sec,
        "concurrency": concurrency,
        "totalRequests": len(results),
        "totalFailures": len(failures),
        "overallSuccessRate": 0.0 if not results else (len(results) - len(failures)) / len(results),
        "endpoints": endpoints,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--duration-sec", type=int, default=int(os.environ.get("SYNAPSE_PERF_DURATION_SEC", "60")))
    parser.add_argument("--concurrency", type=int, default=int(os.environ.get("SYNAPSE_PERF_CONCURRENCY", "8")))
    parser.add_argument("--timeout-sec", type=float, default=float(os.environ.get("SYNAPSE_PERF_TIMEOUT_SEC", "5")))
    parser.add_argument("--request-delay-ms", type=float, default=float(os.environ.get("SYNAPSE_PERF_REQUEST_DELAY_MS", "0")))
    parser.add_argument("--max-failure-rate", type=float, default=float(os.environ.get("SYNAPSE_PERF_MAX_FAILURE_RATE", "0")))
    args = parser.parse_args()

    scenario_path = Path(args.scenario)
    scenario = _render(json.loads(scenario_path.read_text()))
    base_url_env = str(scenario.get("baseUrlEnv") or "")
    base_url = str(os.environ.get(base_url_env) or scenario.get("baseUrl") or "").strip()
    if not base_url:
        raise SystemExit(f"missing base URL; set {base_url_env}")

    default_headers = dict(scenario.get("headers") or {})
    requests: list[dict[str, Any]] = []
    for request in list(scenario.get("requests") or []):
        merged = dict(request)
        merged["headers"] = {**default_headers, **dict(request.get("headers") or {})}
        requests.append(merged)
    if not requests:
        raise SystemExit("scenario has no requests")

    deadline = time.perf_counter() + max(1, args.duration_sec)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        futures = [
            pool.submit(
                _run_worker,
                base_url=base_url,
                requests=requests,
                deadline=deadline,
                timeout_sec=args.timeout_sec,
                request_delay_sec=max(0.0, args.request_delay_ms) / 1000.0,
            )
            for _ in range(max(1, args.concurrency))
        ]
        results = [row for future in futures for row in future.result()]

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "scenario": str(scenario.get("name") or scenario_path.stem),
        **_summarize(results, args.duration_sec, args.concurrency),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True))
    (out_dir / "raw-results.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in results)
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    failure_rate = 0.0 if not results else summary["totalFailures"] / len(results)
    if failure_rate > max(0.0, args.max_failure_rate):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
