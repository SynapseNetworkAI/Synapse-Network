#!/usr/bin/env python3
"""Small changed-file architecture guard for Agent-generated Python code.

Ruff/Radon/JSCPD do the heavy lifting. This script only adds a repo-specific
finance-sensitive function shape check so new money code cannot become a
single giant state-machine blob.
"""

from __future__ import annotations

import ast
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
GIT_BIN = shutil.which("git")
FINANCE_PATH_MARKERS = (
    "finance",
    "withdraw",
    "refund",
    "balance",
    "ledger",
    "settlement",
    "provider_withdraw_review",
)
MAX_EFFECTIVE_LINES = 80
MAX_NESTING = 4
MAX_ARGS = 8


@dataclass(frozen=True)
class Finding:
    code: str
    path: Path
    line: int
    why: str
    fix: str

    def format(self) -> str:
        rel = self.path.relative_to(REPO_ROOT)
        return (
            f"FATAL {self.code}: {rel}:{self.line}\n"
            f"Why dangerous: {self.why}\n"
            f"Agent fix: {self.fix}"
        )


def _git_output(args: list[str]) -> list[str]:
    if GIT_BIN is None:
        return []
    result = subprocess.run(  # noqa: S603 - command is fixed to resolved git binary; args are internal.
        [GIT_BIN, *args],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


def changed_files() -> list[Path]:
    if os.environ.get("CODE_QUALITY_SCOPE") == "full":
        return [
            path.relative_to(REPO_ROOT)
            for path in sorted((REPO_ROOT / "services").rglob("*.py"))
            if ".venv" not in path.parts and "__pycache__" not in path.parts
        ]

    base_ref = os.environ.get("QUALITY_BASE_REF", "origin/main")
    merge_base = _git_output(["merge-base", "HEAD", base_ref])
    diff_base = merge_base[0] if merge_base else "HEAD"
    tracked = _git_output(["diff", "--name-only", diff_base, "--"])
    untracked = _git_output(["ls-files", "--others", "--exclude-standard"])
    return sorted({Path(item) for item in [*tracked, *untracked]})


def is_finance_sensitive(path: Path) -> bool:
    path_text = path.as_posix().lower()
    if not path_text.endswith(".py"):
        return False
    if not (
        path_text.startswith("services/gateway/src/")
        or path_text.startswith("services/gateway-admin/src/")
    ):
        return False
    return any(marker in path_text for marker in FINANCE_PATH_MARKERS)


def effective_lines(lines: list[str], start: int, end: int) -> int:
    body = lines[start - 1 : end]
    return sum(1 for line in body if line.strip() and not line.lstrip().startswith("#"))


def arg_count(node: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    args = node.args
    return (
        len(args.posonlyargs)
        + len(args.args)
        + len(args.kwonlyargs)
        + (1 if args.vararg else 0)
        + (1 if args.kwarg else 0)
    )


def max_nesting(node: ast.AST) -> int:
    nesting_nodes = (
        ast.If,
        ast.For,
        ast.AsyncFor,
        ast.While,
        ast.Try,
        ast.With,
        ast.AsyncWith,
        ast.Match,
    )

    def walk(current: ast.AST, depth: int) -> int:
        next_depth = depth + 1 if isinstance(current, nesting_nodes) else depth
        child_depths = [walk(child, next_depth) for child in ast.iter_child_nodes(current)]
        return max([next_depth, *child_depths])

    return walk(node, 0)


def scan_file(path: Path) -> list[Finding]:
    absolute = REPO_ROOT / path
    if not absolute.exists():
        return []
    text = absolute.read_text(encoding="utf8")
    lines = text.splitlines()
    try:
        tree = ast.parse(text, filename=str(path))
    except SyntaxError as exc:
        return [
            Finding(
                "ARCH-PY-SYNTAX",
                absolute,
                exc.lineno or 1,
                "Python file cannot be parsed, so architecture gates cannot inspect it.",
                "fix the syntax error before relying on quality gates.",
            )
        ]

    findings: list[Finding] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        end_line = getattr(node, "end_lineno", node.lineno)
        line_count = effective_lines(lines, node.lineno, end_line)
        nesting = max_nesting(node)
        arguments = arg_count(node)
        if line_count > MAX_EFFECTIVE_LINES:
            findings.append(
                Finding(
                    "ARCH-COMPLEXITY-001",
                    absolute,
                    node.lineno,
                    f"function `{node.name}` has {line_count} effective lines; Agent is piling state-machine logic into one function.",
                    "extract validation, state transition, persistence, and audit writing into smaller named functions; keep each under 80 effective lines.",
                )
            )
        if nesting > MAX_NESTING:
            findings.append(
                Finding(
                    "ARCH-NESTING-002",
                    absolute,
                    node.lineno,
                    f"function `{node.name}` has nesting depth {nesting}; deeply nested finance logic hides edge cases.",
                    "replace nested if/else ladders with guard clauses, explicit state handlers, or a small state-machine table.",
                )
            )
        if arguments > MAX_ARGS:
            findings.append(
                Finding(
                    "ARCH-ARGS-003",
                    absolute,
                    node.lineno,
                    f"function `{node.name}` has {arguments} parameters; wide signatures usually mean hidden coupling.",
                    "introduce a typed request/context object or split responsibilities so the public function stays narrow.",
                )
            )
    return findings


def main() -> int:
    targets = [path for path in changed_files() if is_finance_sensitive(path)]
    if not targets:
        print("[architecture-shape] no changed finance-sensitive Python files")
        return 0

    findings: list[Finding] = []
    for path in targets:
        findings.extend(scan_file(path))

    if findings:
        for finding in findings:
            print(finding.format(), file=sys.stderr)
        return 1

    print(f"[architecture-shape] passed {len(targets)} finance-sensitive Python file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
