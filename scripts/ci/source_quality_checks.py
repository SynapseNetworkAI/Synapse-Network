#!/usr/bin/env python3
"""Source-shape quality checks for raw-map public return contracts.

This gate is intentionally incremental by default: it blocks newly introduced
public raw-map return annotations without turning historical debt into a
stop-the-world migration. Set SOURCE_QUALITY_SCOPE=full to audit all matching
production source files.
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
GIT_BIN = shutil.which("git")

SOURCE_ROOTS = (
    Path("services/gateway/src"),
    Path("services/gateway-admin/src"),
    Path("services/user-front/src"),
    Path("services/admin-front/src"),
)
BASELINE_PATH = REPO_ROOT / "scripts" / "ci" / "source_quality_baseline.json"

PY_RAW_MAP_RETURNS = {"dict", "Dict", "Mapping", "MutableMapping"}
TS_RAW_MAP_PATTERNS = (
    re.compile(r"\bPromise\s*<\s*Record\s*<\s*string\s*,\s*unknown\s*>\s*>"),
    re.compile(r"\bRecord\s*<\s*string\s*,\s*unknown\s*>"),
)

ALLOWED_NAME_PREFIXES = (
    "_",
    "parse_",
    "normalize_",
    "normalized_",
    "serialize_",
    "serialized_",
    "build_",
    "as_",
)
ALLOWED_NAME_SUFFIXES = (
    "_dict",
    "_json",
    "_payload",
    "_schema",
    "_schemas",
    "_headers",
    "_meta",
    "_metadata",
    "_map",
    "_index",
    "_stats",
    "_by_target",
)
ALLOWED_EXACT_NAMES = {
    "dict_payload",
    "to_dict",
    "model_dump",
}
TS_ALLOWED_NAME_PREFIXES = (
    "parse",
    "normalize",
    "serialize",
    "build",
    "as",
)
TS_ALLOWED_NAME_SUFFIXES = (
    "Payload",
    "Schema",
    "Schemas",
    "Body",
    "Patch",
    "Map",
    "Index",
    "Details",
    "Metadata",
)


@dataclass(frozen=True)
class Finding:
    code: str
    path: Path
    line: int
    symbol: str
    return_type: str
    language: str

    @property
    def baseline_key(self) -> str:
        rel = self.path.relative_to(REPO_ROOT).as_posix()
        return f"{self.code}:{rel}:{self.line}:{self.symbol}"

    def format(self) -> str:
        rel = self.path.relative_to(REPO_ROOT)
        return (
            f"FATAL {self.code}: {rel}:{self.line}\n"
            f"Why dangerous: public `{self.symbol}` returns raw map type `{self.return_type}`; "
            "callers cannot rely on a stable object contract.\n"
            "Agent fix: return a dataclass/Pydantic model for Python or an explicit "
            "TypeScript interface/type; keep raw maps only inside serializers, request "
            "bodies, patches, schema/payload fields, or private helpers."
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


def _merge_base() -> str:
    base_ref = os.environ.get("QUALITY_BASE_REF", "origin/main")
    merge_base = _git_output(["merge-base", "HEAD", base_ref])
    return merge_base[0] if merge_base else "HEAD"


def _changed_files() -> list[Path]:
    if os.environ.get("SOURCE_QUALITY_SCOPE") == "full":
        files: list[Path] = []
        for root in SOURCE_ROOTS:
            for suffix in ("*.py", "*.ts", "*.tsx"):
                files.extend(path.relative_to(REPO_ROOT) for path in (REPO_ROOT / root).rglob(suffix))
        return sorted(files)

    base = _merge_base()
    tracked = _git_output(["diff", "--name-only", base, "--"])
    staged = _git_output(["diff", "--cached", "--name-only", "--"])
    untracked = _git_output(["ls-files", "--others", "--exclude-standard"])
    return sorted({Path(item) for item in [*tracked, *staged, *untracked]})


def _old_text(path: Path) -> str:
    return "\n".join(_git_output(["show", f"{_merge_base()}:{path.as_posix()}"]))


def _is_source_file(path: Path) -> bool:
    text = path.as_posix()
    if not any(text.startswith(root.as_posix() + "/") for root in SOURCE_ROOTS):
        return False
    return path.suffix in {".py", ".ts", ".tsx"}


def _is_allowed_python_symbol(name: str) -> bool:
    return (
        name in ALLOWED_EXACT_NAMES
        or name.startswith(ALLOWED_NAME_PREFIXES)
        or name.endswith(ALLOWED_NAME_SUFFIXES)
    )


def _is_allowed_ts_symbol(name: str) -> bool:
    return (
        name.startswith("_")
        or name.startswith(TS_ALLOWED_NAME_PREFIXES)
        or name.endswith(TS_ALLOWED_NAME_SUFFIXES)
        or name in {"toDict", "toJSON", "modelDump"}
    )


def _annotation_name(node: ast.AST | None) -> str:
    result = ""
    if node is None:
        return result
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        left = _annotation_name(node.left)
        right = _annotation_name(node.right)
        result = f"{left}|{right}"
    elif isinstance(node, ast.Name):
        result = node.id
    elif isinstance(node, ast.Attribute):
        result = node.attr
    elif isinstance(node, ast.Subscript):
        result = _annotation_name(node.value)
    elif isinstance(node, ast.Constant):
        result = str(node.value)
    return result


def _annotation_text(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return _annotation_name(node)


def _returns_raw_map(node: ast.AST | None) -> bool:
    if node is None:
        return False
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _returns_raw_map(node.left) or _returns_raw_map(node.right)
    if isinstance(node, ast.Subscript):
        return _returns_raw_map(node.value) or _returns_raw_map(node.slice)
    if isinstance(node, ast.Tuple):
        return any(_returns_raw_map(element) for element in node.elts)
    return _annotation_name(node) in PY_RAW_MAP_RETURNS


def scan_python_text(path: Path, text: str) -> list[Finding]:
    try:
        tree = ast.parse(text, filename=path.as_posix())
    except SyntaxError as exc:
        return [
            Finding(
                "SOURCE-PY-SYNTAX",
                REPO_ROOT / path,
                exc.lineno or 1,
                "<module>",
                "syntax-error",
                "python",
            )
        ]

    findings: list[Finding] = []
    parent_by_child: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parent_by_child[child] = parent

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if not _returns_raw_map(node.returns):
            continue
        if _is_allowed_python_symbol(node.name):
            continue
        parent = parent_by_child.get(node)
        if not isinstance(parent, (ast.Module, ast.ClassDef)):
            continue
        findings.append(
            Finding(
                "SOURCE-RAW-MAP-RETURN-PY",
                REPO_ROOT / path,
                node.lineno,
                node.name,
                _annotation_text(node.returns),
                "python",
            )
        )
    return findings


def _function_name_from_ts(line: str) -> str | None:
    patterns = (
        r"\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(",
        r"\b(?:public\s+)?(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*:\s*",
        r"\bexport\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]",
        r"\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*",
    )
    for pattern in patterns:
        match = re.search(pattern, line)
        if match:
            return match.group(1)
    return None


def _ts_return_annotation(line: str) -> str:
    arrow_match = re.search(r"\)\s*:\s*([^=]+?)\s*=>", line)
    if arrow_match:
        return arrow_match.group(1).strip()
    function_match = re.search(r"\)\s*:\s*([^{;]+)", line)
    if function_match:
        return function_match.group(1).strip()
    const_match = re.search(r"=\s*(?:async\s*)?\([^)]*\)\s*:\s*([^=]+?)\s*=>", line)
    if const_match:
        return const_match.group(1).strip()
    return ""


def scan_typescript_text(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for index, line in enumerate(text.splitlines(), start=1):
        return_annotation = _ts_return_annotation(line)
        if "Record" not in return_annotation:
            continue
        if not any(pattern.search(return_annotation) for pattern in TS_RAW_MAP_PATTERNS):
            continue
        name = _function_name_from_ts(line)
        if not name:
            continue
        is_exported = "export " in line
        looks_like_method = bool(return_annotation)
        if not is_exported and not looks_like_method:
            continue
        if _is_allowed_ts_symbol(name):
            continue
        return_type = (
            "Promise<Record<string, unknown>>"
            if return_annotation.startswith("Promise")
            else "Record<string, unknown>"
        )
        findings.append(
            Finding(
                "SOURCE-RAW-MAP-RETURN-TS",
                REPO_ROOT / path,
                index,
                name,
                return_type,
                "typescript",
            )
        )
    return findings


def scan_text(path: Path, text: str) -> list[Finding]:
    if path.suffix == ".py":
        return scan_python_text(path, text)
    if path.suffix in {".ts", ".tsx"}:
        return scan_typescript_text(path, text)
    return []


def _finding_key(finding: Finding) -> tuple[str, int, str, str]:
    rel = finding.path.relative_to(REPO_ROOT).as_posix()
    return (rel, finding.line, finding.symbol, finding.return_type)


def _load_baseline() -> set[str]:
    baseline_path = Path(os.environ.get("SOURCE_QUALITY_BASELINE", str(BASELINE_PATH)))
    if not baseline_path.exists():
        return set()
    payload = json.loads(baseline_path.read_text(encoding="utf-8"))
    return {str(item) for item in payload.get("allow", [])}


def scan_files(paths: list[Path], *, incremental: bool = True) -> list[Finding]:
    findings: list[Finding] = []
    for path in paths:
        if not _is_source_file(path):
            continue
        absolute = REPO_ROOT / path
        if not absolute.exists():
            continue
        current_findings = scan_text(path, absolute.read_text(encoding="utf8"))
        if incremental and os.environ.get("SOURCE_QUALITY_SCOPE") != "full":
            old_findings = {
                _finding_key(finding)
                for finding in scan_text(path, _old_text(path))
                if finding.code != "SOURCE-PY-SYNTAX"
            }
            current_findings = [
                finding for finding in current_findings if _finding_key(finding) not in old_findings
            ]
        findings.extend(current_findings)
    return findings


def main() -> int:
    baseline = _load_baseline()
    findings = [finding for finding in scan_files(_changed_files()) if finding.baseline_key not in baseline]
    if findings:
        for finding in findings:
            print(finding.format(), file=sys.stderr)
        return 1
    print("[source-quality] passed raw-map public return check")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
