from __future__ import annotations

import asyncio

from src.core.config import settings
from src.services.provider.manifest_parser_service import parse_manifest_from_curl


SAMPLE_API_BLOCK = '''curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
{"input_text":"关于坚持","quotes":["穷则独善其身，达则兼济天下。—— 孟子","路漫漫其修远兮，吾将上下而求索。—— 屈原","不积跬步，无以至千里。—— 荀子"]}'''


def test_parse_manifest_from_curl_fallback_builds_v1_manifest_from_curl_and_result(monkeypatch) -> None:
    monkeypatch.setattr(settings, "deepseek_api_key", "")

    result = asyncio.run(parse_manifest_from_curl(SAMPLE_API_BLOCK, current_manifest=None))

    assert result["fallback"] is True
    manifest = result["manifest"]

    assert manifest["service_id"] == "svc_api_v1_quotes_famous_top3"
    assert manifest["service_name"] == "Famous Top3"
    assert manifest["billing"]["price_model"] == "fixed"
    assert manifest["runtime"]["endpoint_url"] == "http://127.0.0.1:8100/api/v1/quotes/famous/top3"
    assert manifest["runtime"]["auth_mode"] == "gateway_forward"

    assert manifest["model_usage"]["supported_languages"] == ["cn"]
    assert manifest["model_usage"]["task_category"] == "text.quotes"
    assert manifest["model_usage"]["examples"][0]["input"] == {"text": "关于坚持"}
    assert manifest["model_usage"]["examples"][0]["output"] == {
        "input_text": "关于坚持",
        "quotes": [
            "穷则独善其身，达则兼济天下。—— 孟子",
            "路漫漫其修远兮，吾将上下而求索。—— 屈原",
            "不积跬步，无以至千里。—— 荀子",
        ],
    }

    assert manifest["io_schema"]["input_schema"]["type"] == "object"
    assert manifest["io_schema"]["input_schema"]["properties"]["text"]["type"] == "string"
    assert manifest["io_schema"]["output_schema"]["properties"]["quotes"]["type"] == "array"

    assert manifest["gateway_extensions"]["health_check"]["method"] == "GET"
    assert manifest["gateway_extensions"]["health_check"]["interval_sec"] == 10
    assert manifest["gateway_extensions"]["health_check"]["success_codes"] == [200]
    assert manifest["gateway_extensions"]["routing_targets"][0]["url"] == "http://127.0.0.1:8100/api/v1/quotes/famous/top3"
