#!/usr/bin/env python3
"""Static pre-launch stress review for gateway runtime code.

The scan intentionally focuses on low-noise reliability hazards:

1. external network calls without hard timeouts
2. sync network calls inside ``async def``
3. external I/O inside DB transactions
4. obvious unbounded fetch/materialization points
5. required hot-path indexes in the gateway bootstrap schema

It is not a replacement for staging load, chaos, or EXPLAIN ANALYZE reports.
It is a fast gate that prevents the most common "works locally, melts in
production" patterns from entering the runtime.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal


Severity = Literal["ERROR", "WARN"]


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCAN_ROOTS = (REPO_ROOT / "services" / "gateway" / "src",)
GATEWAY_SCHEMA = (
    REPO_ROOT
    / "infra"
    / "postgres"
    / "init"
    / "gateway"
    / "001_synapse_schema.sql"
)

SYNC_NETWORK_PATTERNS = (
    "requests.",
    "urllib.request.urlopen",
    "Web3.HTTPProvider(",
    ".HTTPProvider(",
)

NETWORK_CALL_PATTERNS = (
    "requests.get(",
    "requests.post(",
    "requests.put(",
    "requests.patch(",
    "requests.delete(",
    "requests.request(",
    "urllib.request.urlopen(",
    "httpx.get(",
    "httpx.post(",
    "httpx.put(",
    "httpx.patch(",
    "httpx.delete(",
    "httpx.request(",
    "httpx.Client(",
    "httpx.AsyncClient(",
)

REQUIRED_INDEX_NAMES = (
    "idx_synapse_invocations_service_created",
    "idx_synapse_ledger_entries_reference",
    "idx_synapse_vault_deposits_owner_created",
    "idx_synapse_vault_withdrawals_kind_owner",
    "idx_synapse_feedback_reports_route_created",
    "idx_synapse_feedback_reports_owner_created",
    "idx_synapse_forum_topics_category_activity",
    "idx_synapse_forum_topics_activity",
    "idx_synapse_forum_replies_topic_created",
)


@dataclass(frozen=True)
class Finding:
    severity: Severity
    path: Path
    line: int
    code: str
    message: str

    def format(self) -> str:
        rel = self.path.relative_to(REPO_ROOT)
        return f"{self.severity} {rel}:{self.line} [{self.code}] {self.message}"


def _python_files(roots: Iterable[Path]) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        if root.is_file() and root.suffix == ".py":
            files.append(root)
            continue
        files.extend(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)
    return sorted(set(files))


def _line_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _statement_from(lines: list[str], start_index: int) -> str:
    """Return the likely Python call statement starting at ``start_index``."""
    statement: list[str] = []
    balance = 0
    seen_open = False
    for line in lines[start_index:]:
        statement.append(line)
        for char in line:
            if char in "([{":
                balance += 1
                seen_open = True
            elif char in ")]}":
                balance -= 1
        if seen_open and balance <= 0:
            break
        if not seen_open:
            break
    return "\n".join(statement)


def _iter_async_blocks(lines: list[str]) -> Iterable[tuple[int, int, int]]:
    for index, line in enumerate(lines):
        stripped = line.lstrip(" ")
        if not stripped.startswith("async def "):
            continue
        indent = _line_indent(line)
        end = len(lines)
        for cursor in range(index + 1, len(lines)):
            candidate = lines[cursor]
            if not candidate.strip():
                continue
            if _line_indent(candidate) <= indent and not candidate.lstrip(" ").startswith("@"):
                end = cursor
                break
        yield index, end, indent


def _iter_with_blocks(lines: list[str], marker_re: re.Pattern[str]) -> Iterable[tuple[int, int, int]]:
    for index, line in enumerate(lines):
        if not marker_re.search(line):
            continue
        indent = _line_indent(line)
        end = len(lines)
        for cursor in range(index + 1, len(lines)):
            candidate = lines[cursor]
            if not candidate.strip():
                continue
            if _line_indent(candidate) <= indent:
                end = cursor
                break
        yield index, end, indent


def _has_ignore(line: str) -> bool:
    return "stress-scan: ignore" in line


def scan_network_timeouts(path: Path, lines: list[str]) -> list[Finding]:
    findings: list[Finding] = []
    for index, line in enumerate(lines):
        if _has_ignore(line):
            continue

        statement = _statement_from(lines, index)
        if "HTTPProvider(" in line and "request_kwargs" not in statement:
            findings.append(
                Finding(
                    "ERROR",
                    path,
                    index + 1,
                    "RPC_TIMEOUT_MISSING",
                    "Web3 HTTPProvider must set request_kwargs.timeout; wait_for/to_thread cannot kill a stuck RPC call.",
                )
            )

        if "psycopg.connect(" in line and "connect_timeout" not in statement:
            findings.append(
                Finding(
                    "ERROR",
                    path,
                    index + 1,
                    "DB_CONNECT_TIMEOUT_MISSING",
                    "Postgres connections must set connect_timeout to avoid pool/thread starvation.",
                )
            )

        if any(pattern in line for pattern in NETWORK_CALL_PATTERNS):
            if "timeout=" not in statement and "httpx.Timeout(" not in statement:
                findings.append(
                    Finding(
                        "ERROR",
                        path,
                        index + 1,
                        "NETWORK_TIMEOUT_MISSING",
                        "External HTTP calls must include an explicit timeout.",
                    )
                )
    return findings


def scan_async_blocking(path: Path, lines: list[str]) -> list[Finding]:
    findings: list[Finding] = []
    for start, end, _indent in _iter_async_blocks(lines):
        block = "\n".join(lines[start:end])
        if "asyncio.to_thread(" in block or "run_in_executor(" in block:
            continue
        for pattern in SYNC_NETWORK_PATTERNS:
            for offset, line in enumerate(lines[start:end], start=start):
                if pattern in line and not _has_ignore(line):
                    findings.append(
                        Finding(
                            "ERROR",
                            path,
                            offset + 1,
                            "SYNC_IO_IN_ASYNC",
                            f"async def contains synchronous external I/O pattern `{pattern}` without executor isolation.",
                        )
                    )
                    break
    return findings


def scan_wait_in_transaction(path: Path, lines: list[str]) -> list[Finding]:
    findings: list[Finding] = []
    tx_marker = re.compile(r"with .*?(tx_cursor|session\.begin|uow\.tx|\.begin\()")
    for start, end, _indent in _iter_with_blocks(lines, tx_marker):
        block = "\n".join(lines[start:end])
        for pattern in (*NETWORK_CALL_PATTERNS, "HTTPProvider("):
            if pattern in block:
                findings.append(
                    Finding(
                        "ERROR",
                        path,
                        start + 1,
                        "WAIT_IN_TRANSACTION",
                        "DB transaction block contains external network I/O; fetch external result before opening the transaction.",
                    )
                )
                break
    return findings


def scan_unbounded_reads(path: Path, lines: list[str]) -> list[Finding]:
    findings: list[Finding] = []
    for index, line in enumerate(lines):
        if ".fetchall()" not in line and ".all()" not in line:
            continue
        window = "\n".join(lines[max(0, index - 25) : index + 1]).upper()
        if "LIMIT" in window or "COUNT(*)" in window:
            continue
        findings.append(
            Finding(
                "WARN",
                path,
                index + 1,
                "POTENTIAL_UNBOUNDED_READ",
                "Materializing all rows needs an explicit bound, cursor, or documented low-cardinality invariant.",
            )
        )

    module_level_dict = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*(cache|counters|window|state)[a-zA-Z0-9_]*\s*:\s*.*=\s*\{\}")
    for index, line in enumerate(lines):
        if _line_indent(line) != 0:
            continue
        if module_level_dict.search(line):
            findings.append(
                Finding(
                    "WARN",
                    path,
                    index + 1,
                    "POTENTIAL_UNBOUNDED_CACHE",
                    "Module-level in-memory caches need TTL/pruning or a Redis-backed production path.",
                )
            )
    return findings


def scan_required_indexes(schema_path: Path) -> list[Finding]:
    if not schema_path.exists():
        return [
            Finding(
                "ERROR",
                schema_path,
                1,
                "SCHEMA_MISSING",
                "Gateway bootstrap schema file is missing; cannot verify hot-path indexes.",
            )
        ]
    content = schema_path.read_text(encoding="utf8")
    findings: list[Finding] = []
    for index_name in REQUIRED_INDEX_NAMES:
        if index_name not in content:
            findings.append(
                Finding(
                    "ERROR",
                    schema_path,
                    1,
                    "HOT_PATH_INDEX_MISSING",
                    f"Expected hot-path index `{index_name}` is not present in gateway schema.",
                )
            )
    return findings


def run_scan(roots: Iterable[Path], *, include_warnings_as_errors: bool) -> int:
    findings: list[Finding] = []
    for path in _python_files(roots):
        lines = path.read_text(encoding="utf8").splitlines()
        findings.extend(scan_network_timeouts(path, lines))
        findings.extend(scan_async_blocking(path, lines))
        findings.extend(scan_wait_in_transaction(path, lines))
        findings.extend(scan_unbounded_reads(path, lines))
    findings.extend(scan_required_indexes(GATEWAY_SCHEMA))

    errors = [finding for finding in findings if finding.severity == "ERROR"]
    warnings = [finding for finding in findings if finding.severity == "WARN"]

    print("[gateway-stress-review] static scan")
    print(f"[gateway-stress-review] roots: {', '.join(str(path.relative_to(REPO_ROOT)) for path in roots)}")
    print(f"[gateway-stress-review] errors={len(errors)} warnings={len(warnings)}")
    for finding in findings:
        print(finding.format())

    if errors or (include_warnings_as_errors and warnings):
        return 1
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        help="Optional files/directories to scan. Defaults to services/gateway/src.",
    )
    parser.add_argument(
        "--warnings-as-errors",
        action="store_true",
        help="Treat advisory unbounded-read/cache warnings as hard failures.",
    )
    args = parser.parse_args(argv)
    roots = tuple((REPO_ROOT / path).resolve() for path in args.paths) if args.paths else DEFAULT_SCAN_ROOTS
    return run_scan(roots, include_warnings_as_errors=args.warnings_as_errors)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
