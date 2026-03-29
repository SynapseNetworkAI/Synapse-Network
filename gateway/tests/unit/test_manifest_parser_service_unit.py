from __future__ import annotations

import asyncio

from src.core.config import settings
from src.services.provider.manifest_parser_service import parse_manifest_from_curl


SAMPLE_API_BLOCK = '''curl -X POST "http://127.0.0.1:8100/api/v1/quotes/famous/top3" \
  -H "Content-Type: application/json" \
  -d '{"text":"关于坚持"}'
{"input_text":"关于坚持","quotes":["穷则独善其身，达则兼济天下。—— 孟子","路漫漫其修远兮，吾将上下而求索。—— 屈原","不积跬步，无以至千里。—— 荀子"]}'''

SENTIMENT_API_BLOCK = """curl -X POST "http://127.0.0.1:8100/provider-services/web3-sentiment-index/invoke" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ETH","chain":"ethereum","lookback_hours":24,"include_narrative":true}'
{"service":{"serviceId":"svc_web3_sentiment_index","serviceName":"Web3 Sentiment Index","version":"1.0.0"},"sources":[{"name":"alternative_me","freshnessSec":1800},{"name":"coingecko","freshnessSec":45},{"name":"binance_market_data","freshnessSec":8}],"freshness":{"generatedAt":"2026-03-23T12:00:00Z","maxSourceAgeSec":1800,"cacheHit":false},"result":{"symbol":"ETH","sentiment_score":68,"sentiment_label":"greed","trend_direction":"up","volatility_signal":"medium","market_temperature":"risk-on but not overheated","reasoning_bullets":["Fear and Greed baseline is above neutral.","Short-term price momentum remains positive."],"action_hint":"Suitable for momentum-following agents, but keep tighter risk controls than in a low-volatility regime."},"errors":[]}"""


def test_parse_manifest_from_curl_fallback_builds_v1_manifest_from_curl_and_result(monkeypatch) -> None:
    monkeypatch.setattr(settings, "deepseek_api_key", "")

    result = asyncio.run(parse_manifest_from_curl(SAMPLE_API_BLOCK, current_manifest=None))

    assert result["fallback"] is True
    manifest = result["manifest"]

    assert manifest["service_id"] == "svc_quotes_famous_top3"
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


def test_parse_manifest_from_curl_fallback_recognizes_standard_provider_service_sentiment_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(settings, "deepseek_api_key", "")

    result = asyncio.run(
        parse_manifest_from_curl(SENTIMENT_API_BLOCK, current_manifest=None)
    )

    assert result["fallback"] is True
    manifest = result["manifest"]

    assert manifest["service_id"] == "svc_web3_sentiment_index"
    assert manifest["service_name"] == "Web3 Sentiment Index"
    assert manifest["service_slug"] == "web3-sentiment-index"
    assert manifest["model_usage"]["task_category"] == "web3.market.sentiment"
    assert manifest["model_usage"]["capabilities"][:3] == [
        "market_sentiment_scoring",
        "trend_summary",
        "volatility_signal",
    ]
    assert manifest["runtime"]["endpoint_url"] == "http://127.0.0.1:8100/provider-services/web3-sentiment-index/invoke"
    assert manifest["runtime"]["auth_mode"] == "gateway_signed"
    assert manifest["model_usage"]["examples"][0]["input"] == {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
        "include_narrative": True,
    }
    assert (
        manifest["io_schema"]["output_schema"]["properties"]["result"]["properties"][
            "reasoning_bullets"
        ]["type"]
        == "array"
    )
