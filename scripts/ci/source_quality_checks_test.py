#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from source_quality_checks import scan_python_text, scan_text, scan_typescript_text


def test_python_dict_any_return_fails() -> None:
    findings = scan_python_text(
        Path("services/gateway/src/services/example.py"),
        """
from typing import Any, Dict

def create_item() -> Dict[str, Any]:
    return {"ok": True}
""",
    )
    assert "SOURCE-RAW-MAP-RETURN-PY" in "\n".join(f.code for f in findings)


def test_python_bare_dict_return_fails() -> None:
    findings = scan_python_text(
        Path("services/gateway-admin/src/services/example.py"),
        """
def list_items() -> dict:
    return {"items": []}
""",
    )
    assert len(findings) == 1
    assert findings[0].return_type == "dict"


def test_python_nested_dict_return_fails() -> None:
    findings = scan_python_text(
        Path("services/gateway/src/services/example.py"),
        """
from typing import Any

def list_items() -> list[dict[str, Any]]:
    return []
""",
    )
    assert len(findings) == 1
    assert findings[0].symbol == "list_items"


def test_python_private_helper_and_payload_argument_pass() -> None:
    findings = scan_python_text(
        Path("services/gateway/src/services/example.py"),
        """
from typing import Any

def _serialize_item(row: object) -> dict[str, Any]:
    return {}

def create_item(payload: dict[str, Any]) -> ExampleResponse:
    return ExampleResponse()
""",
    )
    assert findings == []


def test_python_typed_object_return_passes() -> None:
    findings = scan_python_text(
        Path("services/gateway/src/services/example.py"),
        """
from dataclasses import dataclass

@dataclass(frozen=True)
class ExampleResponse:
    ok: bool

def create_item() -> ExampleResponse:
    return ExampleResponse(ok=True)
""",
    )
    assert findings == []


def test_typescript_promise_record_return_fails() -> None:
    findings = scan_typescript_text(
        Path("services/user-front/src/utils/exampleApi.ts"),
        """
export async function fetchExample(): Promise<Record<string, unknown>> {
  return {};
}
""",
    )
    assert len(findings) == 1
    assert findings[0].code == "SOURCE-RAW-MAP-RETURN-TS"


def test_typescript_direct_record_return_fails() -> None:
    findings = scan_typescript_text(
        Path("services/user-front/src/utils/exampleApi.ts"),
        """
export function fetchExample(): Record<string, unknown> {
  return {};
}
""",
    )
    assert len(findings) == 1
    assert findings[0].symbol == "fetchExample"


def test_typescript_payload_body_and_explicit_interface_pass() -> None:
    findings = scan_typescript_text(
        Path("services/user-front/src/utils/exampleApi.ts"),
        """
interface ExampleResponse {
  ok: boolean;
}

export async function fetchExample(body: Record<string, unknown>): Promise<ExampleResponse> {
  return { ok: Boolean(body) };
}
""",
    )
    assert findings == []


def test_frontend_native_confirm_fails() -> None:
    findings = scan_text(
        Path("services/user-front/src/components/example.tsx"),
        """
export function Example() {
  return <button onClick={() => window.confirm("danger")}>Delete</button>;
}
""",
    )
    assert len(findings) == 1
    assert findings[0].code == "SOURCE-NATIVE-BROWSER-DIALOG-FRONTEND"
    assert findings[0].symbol == "confirm"


def test_frontend_native_confirm_in_test_file_passes() -> None:
    findings = scan_text(
        Path("services/user-front/src/components/example.test.tsx"),
        """
globalThis.confirm = vi.fn();
""",
    )
    assert findings == []


if __name__ == "__main__":
    for name, test_func in sorted(globals().items()):
        if name.startswith("test_") and callable(test_func):
            test_func()
    print("[source-quality-checks-test] passed")
