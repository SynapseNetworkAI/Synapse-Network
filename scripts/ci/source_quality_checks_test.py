#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path

from source_quality_checks import scan_python_text, scan_typescript_text


class SourceQualityChecksTest(unittest.TestCase):
    def test_python_dict_any_return_fails(self) -> None:
        findings = scan_python_text(
            Path("services/gateway/src/services/example.py"),
            """
from typing import Any, Dict

def create_item() -> Dict[str, Any]:
    return {"ok": True}
""",
        )
        self.assertIn("SOURCE-RAW-MAP-RETURN-PY", "\n".join(f.code for f in findings))

    def test_python_bare_dict_return_fails(self) -> None:
        findings = scan_python_text(
            Path("services/gateway-admin/src/services/example.py"),
            """
def list_items() -> dict:
    return {"items": []}
""",
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].return_type, "dict")

    def test_python_private_helper_and_payload_argument_pass(self) -> None:
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
        self.assertEqual(findings, [])

    def test_python_typed_object_return_passes(self) -> None:
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
        self.assertEqual(findings, [])

    def test_typescript_promise_record_return_fails(self) -> None:
        findings = scan_typescript_text(
            Path("services/user-front/src/utils/exampleApi.ts"),
            """
export async function fetchExample(): Promise<Record<string, unknown>> {
  return {};
}
""",
        )
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0].code, "SOURCE-RAW-MAP-RETURN-TS")

    def test_typescript_payload_body_and_explicit_interface_pass(self) -> None:
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
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
