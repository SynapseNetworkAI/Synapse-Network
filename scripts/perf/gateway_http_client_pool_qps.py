#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

import httpx


async def _handle_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        data = await reader.readuntil(b"\r\n\r\n")
        headers = data.decode("latin1", errors="ignore").split("\r\n")
        content_length = 0
        for header in headers:
            if header.lower().startswith("content-length:"):
                content_length = int(header.split(":", 1)[1].strip() or "0")
                break
        if content_length:
            await reader.readexactly(content_length)
        body = b'{"ok":true,"quote":{"answer":"pong"}}'
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"content-type: application/json\r\n"
            + f"content-length: {len(body)}\r\n".encode("ascii")
            + b"connection: keep-alive\r\n\r\n"
            + body
        )
        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def _run_requests(
    *,
    total: int,
    concurrency: int,
    request_fn: Callable[[int], Awaitable[None]],
) -> tuple[float, list[float]]:
    latencies_ms: list[float] = []
    next_id = 0
    lock = asyncio.Lock()

    async def worker() -> None:
        nonlocal next_id
        while True:
            async with lock:
                if next_id >= total:
                    return
                request_id = next_id
                next_id += 1
            started = time.perf_counter()
            await request_fn(request_id)
            latencies_ms.append((time.perf_counter() - started) * 1000)

    started = time.perf_counter()
    await asyncio.gather(*(worker() for _ in range(concurrency)))
    duration_sec = max(0.000001, time.perf_counter() - started)
    return duration_sec, latencies_ms


def _summary(name: str, total: int, duration_sec: float, latencies_ms: list[float]) -> dict[str, float | int | str]:
    ordered = sorted(latencies_ms)
    p50 = statistics.median(ordered) if ordered else 0.0
    p95 = ordered[max(0, int(len(ordered) * 0.95) - 1)] if ordered else 0.0
    p99 = ordered[max(0, int(len(ordered) * 0.99) - 1)] if ordered else 0.0
    return {
        "mode": name,
        "requests": total,
        "durationSec": round(duration_sec, 4),
        "qps": round(total / duration_sec, 2),
        "p50Ms": round(p50, 3),
        "p95Ms": round(p95, 3),
        "p99Ms": round(p99, 3),
    }


async def _main() -> int:
    parser = argparse.ArgumentParser(description="Compare per-call httpx client vs shared pool QPS.")
    parser.add_argument("--requests", type=int, default=1000)
    parser.add_argument("--concurrency", type=int, default=64)
    parser.add_argument("--output-dir", default="output/performance/http-client-pool")
    args = parser.parse_args()

    server = await asyncio.start_server(_handle_http, "127.0.0.1", 0)
    host, port = server.sockets[0].getsockname()[:2]
    url = f"http://{host}:{port}/invoke"

    async with server:
        async def per_call(request_id: int) -> None:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(url, json={"requestId": request_id})
                response.raise_for_status()

        before_duration, before_latencies = await _run_requests(
            total=args.requests,
            concurrency=args.concurrency,
            request_fn=per_call,
        )

        limits = httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)
        timeout = httpx.Timeout(5.0, connect=1.0, read=5.0, write=2.0, pool=0.05)
        async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
            async def pooled(request_id: int) -> None:
                response = await client.post(url, json={"requestId": request_id})
                response.raise_for_status()

            after_duration, after_latencies = await _run_requests(
                total=args.requests,
                concurrency=args.concurrency,
                request_fn=pooled,
            )

    before = _summary("before_per_call_client", args.requests, before_duration, before_latencies)
    after = _summary("after_shared_pool", args.requests, after_duration, after_latencies)
    improvement = round(float(after["qps"]) / max(0.000001, float(before["qps"])), 2)
    report = {
        "status": "success",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "requests": args.requests,
        "concurrency": args.concurrency,
        "before": before,
        "after": after,
        "qpsImprovementX": improvement,
    }

    output_root = Path(args.output_dir) / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (output_root / "report.md").write_text(
        "\n".join(
            [
                "# Gateway HTTP Client Pool QPS Benchmark",
                "",
                f"- Requests: {args.requests}",
                f"- Concurrency: {args.concurrency}",
                f"- Before QPS: {before['qps']}",
                f"- After QPS: {after['qps']}",
                f"- Improvement: {improvement}x",
                "",
                "| Mode | QPS | p50 ms | p95 ms | p99 ms | Duration sec |",
                "| --- | ---: | ---: | ---: | ---: | ---: |",
                f"| Before per-call client | {before['qps']} | {before['p50Ms']} | {before['p95Ms']} | {before['p99Ms']} | {before['durationSec']} |",
                f"| After shared pool | {after['qps']} | {after['p50Ms']} | {after['p95Ms']} | {after['p99Ms']} | {after['durationSec']} |",
                "",
                "This benchmark isolates provider HTTP client reuse. It is not a full paid-invoke ledger benchmark.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2))
    print(f"report={output_root / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
