#!/usr/bin/env python3
"""Generate Gateway release full-chain E2E evidence reports."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCENARIOS: dict[str, list[str]] = {
    "deposit": ["test_deposit_full_pipeline"],
    "confirm": ["test_deposit_confirm", "test_balance_reflects_deposit"],
    "service_discovery": [
        "test_service_appears_in_list",
        "test_service_discoverable_by_intent",
        "test_get_quote_for_service",
    ],
    "quote": ["test_get_quote_for_service", "test_01_quote_service"],
    "invoke": ["test_invocation_deducts_balance", "test_02_invoke_service"],
    "provider_credit": ["test_invocation_deducts_balance"],
    "receipt": ["test_invocation_receipt_reachable", "test_03_get_invocation_receipt"],
    "consumer_withdrawal": [
        "test_consumer_withdraw_decreases_available_balance",
        "test_consumer_withdraw_record_has_correct_amount_and_status",
    ],
    "analytics_kafka_clickhouse": [
        "test_analytics_fullchain_events_and_admin_aggregates",
        "test_event_flows_to_clickhouse",
    ],
    "ledger_vault_reconciliation": [
        "test_invocation_deducts_balance",
        "test_consumer_withdraw_reduces_total_spendable_capacity",
    ],
}


def sha256_json(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_text(args: list[str], cwd: Path) -> str:
    result = subprocess.run(args, cwd=cwd, check=False, text=True, capture_output=True)
    return result.stdout.strip()


def http_get_json(url: str, timeout: int = 10) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - local/staging evidence URL
        text = response.read().decode("utf-8")
    if not text.strip():
        return None
    return json.loads(text)


def clickhouse_query(base_url: str, sql: str) -> list[dict[str, Any]]:
    query_url = f"{base_url.rstrip('/')}/?{urllib.parse.urlencode({'query': sql})}"
    request = urllib.request.Request(query_url)
    with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310 - configured evidence URL
        text = response.read().decode("utf-8").strip()
    if not text:
        return []
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def rpc_call(rpc_url: str, method: str, params: list[Any]) -> Any:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        rpc_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310 - configured evidence URL
        payload = json.loads(response.read().decode("utf-8"))
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return payload.get("result")


def parse_junit(junit_path: Path) -> dict[str, Any]:
    tree = ET.parse(junit_path)
    root = tree.getroot()
    suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
    tests = failures = errors = skipped = 0
    cases: list[dict[str, Any]] = []
    for suite in suites:
        tests += int(suite.attrib.get("tests", "0"))
        failures += int(suite.attrib.get("failures", "0"))
        errors += int(suite.attrib.get("errors", "0"))
        skipped += int(suite.attrib.get("skipped", "0"))
        for case in suite.findall("testcase"):
            status = "passed"
            if case.find("failure") is not None:
                status = "failed"
            elif case.find("error") is not None:
                status = "error"
            elif case.find("skipped") is not None:
                status = "skipped"
            cases.append(
                {
                    "classname": case.attrib.get("classname", ""),
                    "name": case.attrib.get("name", ""),
                    "timeSec": case.attrib.get("time", "0"),
                    "status": status,
                }
            )
    return {
        "tests": tests,
        "failures": failures,
        "errors": errors,
        "skipped": skipped,
        "cases": cases,
    }


def scenario_passed(cases: list[dict[str, Any]], patterns: list[str]) -> tuple[bool, str]:
    matched = [
        case for case in cases
        if any(pattern in case["name"] or pattern in case["classname"] for pattern in patterns)
    ]
    if not matched:
        return False, "no matching testcase found"
    bad = [case for case in matched if case["status"] != "passed"]
    if bad:
        return False, ", ".join(f"{case['name']}={case['status']}" for case in bad)
    return True, f"{len(matched)} testcase(s) passed"


def write_environment_manifest(out_dir: Path, root: Path, env_name: str) -> dict[str, Any]:
    manifest = {
        "environment": env_name,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "gitCommitSha": run_text(["git", "rev-parse", "HEAD"], root),
        "gitDirty": bool(run_text(["git", "status", "--short"], root)),
        "operator": os.getenv("USER") or os.getenv("LOGNAME") or "unknown",
        "gatewayBaseUrl": os.getenv("GATEWAY_E2E_GATEWAY_BASE", "http://127.0.0.1:8000"),
        "providerBaseUrl": os.getenv("GATEWAY_E2E_PROVIDER_BASE", "http://127.0.0.1:8001"),
        "rpcUrl": os.getenv("GATEWAY_E2E_RPC_URL", "http://127.0.0.1:8545"),
        "clickHouseUrl": os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://127.0.0.1:8123"),
        "kafkaBootstrapServers": os.getenv("ANALYTICS_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
        "kafkaTopic": os.getenv("ANALYTICS_KAFKA_TOPIC", "synapse.analytics.events"),
    }
    (out_dir / "environment-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def write_contract_manifest(out_dir: Path, root: Path) -> dict[str, Any]:
    config_path = Path(
        os.getenv(
            "GATEWAY_E2E_CONTRACT_CONFIG_PATH",
            str(root / "services" / "user-front" / "src" / "contract-config.json"),
        )
    )
    rpc_url = os.getenv("GATEWAY_E2E_RPC_URL", "http://127.0.0.1:8545")
    manifest: dict[str, Any] = {
        "configPath": str(config_path),
        "rpcUrl": rpc_url,
        "addresses": {},
        "chainId": None,
        "blockNumber": None,
        "codeHashes": {},
        "errors": [],
    }
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        manifest["addresses"] = {
            "SynapseCore": config.get("SynapseCore"),
            "MockUSDC": config.get("MockUSDC") or config.get("USDC"),
        }
        manifest["chainId"] = int(rpc_call(rpc_url, "eth_chainId", []), 16)
        manifest["blockNumber"] = int(rpc_call(rpc_url, "eth_blockNumber", []), 16)
        for name, address in manifest["addresses"].items():
            if not address:
                continue
            code = rpc_call(rpc_url, "eth_getCode", [address, "latest"])
            manifest["codeHashes"][name] = hashlib.sha256(str(code).encode()).hexdigest()
    except Exception as exc:  # noqa: BLE001 - evidence must preserve the failure
        manifest["errors"].append(str(exc))
    (out_dir / "contract-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def write_analytics_summary(out_dir: Path) -> dict[str, Any]:
    clickhouse_url = os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://127.0.0.1:8123")
    summary: dict[str, Any] = {"clickHouseUrl": clickhouse_url, "totalEvents": 0, "events": [], "errors": []}
    try:
        rows = clickhouse_query(
            clickhouse_url,
            """
            SELECT event_name, count() AS count
            FROM synapse_analytics.events
            GROUP BY event_name
            ORDER BY event_name
            FORMAT JSONEachRow
            """,
        )
        summary["events"] = rows
        summary["totalEvents"] = sum(int(row.get("count", 0)) for row in rows)
    except Exception as exc:  # noqa: BLE001 - evidence must preserve the failure
        summary["errors"].append(str(exc))
    (out_dir / "analytics-clickhouse-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def write_reconciliation_summary(out_dir: Path, comparisons: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {
        "source": "gateway e2e expected-vs-actual comparisons",
        "passed": [row for row in comparisons if row["pass"]],
        "failed": [row for row in comparisons if not row["pass"]],
    }
    (out_dir / "reconciliation-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--env", required=True)
    parser.add_argument("--pytest-exit-code", required=True, type=int)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    out_dir = Path(args.out_dir).resolve()
    junit_path = out_dir / "pytest-junit.xml"
    failed: list[str] = []

    environment = write_environment_manifest(out_dir, root, args.env)
    contract = write_contract_manifest(out_dir, root)
    analytics = write_analytics_summary(out_dir)

    if not junit_path.exists():
        failed.append("pytest-junit.xml missing")
        pytest_summary = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "cases": []}
    else:
        pytest_summary = parse_junit(junit_path)

    comparisons: list[dict[str, Any]] = [
        {
            "stage": "pytest",
            "metricName": "Skipped tests",
            "expected": "0",
            "actual": str(pytest_summary["skipped"]),
            "pass": pytest_summary["skipped"] == 0,
        },
        {
            "stage": "pytest",
            "metricName": "Collected tests",
            "expected": ">=78",
            "actual": str(pytest_summary["tests"]),
            "pass": pytest_summary["tests"] >= 78,
        },
        {
            "stage": "analytics",
            "metricName": "ClickHouse events",
            "expected": ">0",
            "actual": str(analytics["totalEvents"]),
            "pass": int(analytics["totalEvents"]) > 0 and not analytics["errors"],
        },
        {
            "stage": "contract",
            "metricName": "Contract manifest errors",
            "expected": "0",
            "actual": str(len(contract["errors"])),
            "pass": len(contract["errors"]) == 0,
        },
    ]
    for scenario, patterns in SCENARIOS.items():
        ok, detail = scenario_passed(pytest_summary["cases"], patterns)
        comparisons.append(
            {
                "stage": "gateway-fullchain",
                "metricName": scenario,
                "expected": "pass",
                "actual": detail,
                "pass": ok,
            }
        )

    if args.pytest_exit_code != 0:
        failed.append(f"pytest exited with {args.pytest_exit_code}")
    if pytest_summary["failures"] or pytest_summary["errors"]:
        failed.append(
            f"pytest failures={pytest_summary['failures']} errors={pytest_summary['errors']}"
        )
    if pytest_summary["skipped"]:
        failed.append(f"pytest skipped={pytest_summary['skipped']}")
    for row in comparisons:
        if not row["pass"]:
            failed.append(f"{row['stage']} / {row['metricName']} expected {row['expected']} actual {row['actual']}")

    reconciliation = write_reconciliation_summary(out_dir, comparisons)
    status = "success" if not failed else "failed"
    report = {
        "status": status,
        "scriptVersion": "gateway-release-evidence:v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "environment": environment,
        "contract": contract,
        "analytics": analytics,
        "reconciliation": reconciliation,
        "pytest": {key: value for key, value in pytest_summary.items() if key != "cases"},
        "comparisons": comparisons,
        "failed": failed,
    }
    report["evidenceDigest"] = sha256_json(
        {
            "scriptVersion": report["scriptVersion"],
            "environment": report["environment"],
            "contract": report["contract"],
            "analytics": report["analytics"],
            "pytest": report["pytest"],
            "comparisons": report["comparisons"],
            "failed": report["failed"],
        }
    )
    (out_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    lines = [
        "# Gateway Release Full-Chain E2E Evidence",
        "",
        f"- Status: `{status}`",
        f"- Environment: `{args.env}`",
        f"- Generated at: `{report['generatedAt']}`",
        f"- Git commit: `{environment['gitCommitSha']}`",
        f"- Git dirty: `{environment['gitDirty']}`",
        f"- Evidence digest: `{report['evidenceDigest']}`",
        "",
        "## Pytest Summary",
        "",
        f"- Tests: `{pytest_summary['tests']}`",
        f"- Failures: `{pytest_summary['failures']}`",
        f"- Errors: `{pytest_summary['errors']}`",
        f"- Skipped: `{pytest_summary['skipped']}`",
        "",
        "## Expected vs Actual",
        "",
        "| Stage | Metric | Expected | Actual | Result |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in comparisons:
        actual = str(row["actual"]).replace("|", "\\|")
        lines.append(
            f"| {row['stage']} | {row['metricName']} | {row['expected']} | {actual} | {'PASS' if row['pass'] else 'FAIL'} |"
        )
    lines.extend(["", "## Failures", ""])
    lines.extend([f"- {item}" for item in failed] or ["- none"])
    lines.extend(
        [
            "",
            "## Evidence Files",
            "",
            "- `pytest-junit.xml`",
            "- `gateway-e2e.log`",
            "- `environment-manifest.json`",
            "- `contract-manifest.json`",
            "- `analytics-clickhouse-summary.json`",
            "- `reconciliation-summary.json`",
        ]
    )
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0 if status == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
