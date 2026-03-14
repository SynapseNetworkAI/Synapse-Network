# pyright: reportMissingImports=false

import pytest
import httpx
import time

from src.services import service_health_service


@pytest.mark.asyncio
async def test_probe_service_health_marks_degraded_when_partial_targets_healthy():
    service = {
        "serviceId": "SVC_HEALTH_1",
        "isActive": True,
        "status": "active",
        "healthCheck": {
            "path": "/health",
            "method": "GET",
            "timeoutMs": 1000,
            "successCodes": [200],
            "healthyThreshold": 1,
            "unhealthyThreshold": 1,
        },
        "invoke": {
            "targets": [
                {"url": "http://healthy.example.com/api/v1/run", "weight": 100},
                {"url": "http://bad.example.com/api/v1/run", "weight": 50},
            ]
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "healthy.example.com" and request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        return httpx.Response(503, json={"status": "down"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        updated = await service_health_service.probe_service_health(service, client=client)

    assert updated["serviceHealth"]["overallStatus"] == "degraded"
    assert updated["serviceHealth"]["healthyTargets"] == 1
    assert updated["serviceHealth"]["totalTargets"] == 2


@pytest.mark.asyncio
async def test_get_healthy_target_urls_respects_stale_window():
    now_ms = 1_710_000_000_000
    service = {
        "isActive": True,
        "status": "active",
        "invoke": {
            "targets": [
                {"url": "http://healthy.example.com/api/v1/run", "weight": 100},
                {"url": "http://bad.example.com/api/v1/run", "weight": 50},
            ]
        },
        "serviceHealth": {
            "overallStatus": "degraded",
            "healthyTargets": 1,
            "totalTargets": 2,
            "lastCheckedAt": now_ms,
            "targets": {
                "http://healthy.example.com/api/v1/run": {
                    "status": "healthy",
                    "lastCheckedAt": now_ms,
                },
                "http://bad.example.com/api/v1/run": {
                    "status": "unhealthy",
                    "lastCheckedAt": now_ms,
                },
            },
        },
    }

    healthy = service_health_service.get_healthy_target_urls(service, now_ms=now_ms + 5000, stale_after_sec=20)
    assert healthy == ["http://healthy.example.com/api/v1/run"]

    stale = service_health_service.get_healthy_target_urls(service, now_ms=now_ms + 121000, stale_after_sec=120)
    assert stale == []


def test_build_probe_url_uses_target_origin_and_health_path():
    probe_url = service_health_service.build_probe_url(
        "http://127.0.0.1:8100/api/v1/quotes/famous",
        "/health",
    )
    assert probe_url == "http://127.0.0.1:8100/health"


def test_sync_service_target_health_table_generates_one_row_per_target(temp_json_storage):
    rows = [
        {
            "serviceId": "serviceA",
            "ownerAddress": "0xabc",
            "isActive": True,
            "status": "active",
            "invoke": {
                "targets": [
                    {"url": "http://url1.example.com/api/v1/run", "weight": 100, "region": "ap-sg-1"},
                    {"url": "http://url2.example.com/api/v1/run", "weight": 80, "region": "ap-sg-2"},
                    {"url": "http://url3.example.com/api/v1/run", "weight": 50, "region": "ap-sg-3"},
                ]
            },
            "serviceHealth": {
                "overallStatus": "degraded",
                "healthyTargets": 1,
                "totalTargets": 3,
                "lastCheckedAt": 1710000000000,
                "targets": {
                    "http://url1.example.com/api/v1/run": {"status": "healthy", "lastCheckedAt": 1710000000000},
                    "http://url2.example.com/api/v1/run": {"status": "degraded", "lastCheckedAt": 1710000000000},
                    "http://url3.example.com/api/v1/run": {"status": "unhealthy", "lastCheckedAt": 1710000000000},
                },
            },
        }
    ]

    saved_count = service_health_service.sync_service_target_health_table(temp_json_storage, rows)
    assert saved_count == 3

    table_rows = temp_json_storage.get_collection("service_target_health")
    assert isinstance(table_rows, list)
    assert len(table_rows) == 3
    assert {row["targetUrl"] for row in table_rows} == {
        "http://url1.example.com/api/v1/run",
        "http://url2.example.com/api/v1/run",
        "http://url3.example.com/api/v1/run",
    }
    assert {row["status"] for row in table_rows} == {"healthy", "degraded", "unhealthy"}


def test_prune_health_history_removes_expired_and_orphan_rows(temp_json_storage, monkeypatch):
    now_ms = int(time.time() * 1000)
    monkeypatch.setattr("src.services.service_health_service.settings.service_health_history_retention_days", 7)

    temp_json_storage.save_collection(
        "service_registry",
        [
            {
                "serviceId": "serviceA",
                "ownerAddress": "0xabc",
                "serviceName": "svc",
                "isActive": True,
                "status": "active",
                "invoke": {"targets": [{"url": "http://url1.example.com/api", "weight": 100}]},
                "serviceHealth": {"targets": {"http://url1.example.com/api": {"status": "healthy", "lastCheckedAt": now_ms}}},
            }
        ],
    )

    temp_json_storage.save_collection(
        "service_target_health_history",
        [
            {"serviceId": "serviceA", "targetUrl": "url1", "checkedAt": now_ms - 1_000},
            {"serviceId": "serviceA", "targetUrl": "url1", "checkedAt": now_ms - (8 * 24 * 60 * 60 * 1000)},
            {"serviceId": "serviceB", "targetUrl": "urlX", "checkedAt": now_ms - 1_000},
        ],
    )

    stats = service_health_service.prune_health_history(temp_json_storage)
    assert stats["removed"] == 2
    rows = temp_json_storage.get_collection("service_target_health_history")
    assert len(rows) == 1
    assert rows[0]["serviceId"] == "serviceA"
