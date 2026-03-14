# pyright: reportMissingImports=false

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402
from app.services import deepseek_client  # noqa: E402


def test_dataset_contains_100_quotes():
    quote_file = ROOT / "app" / "data" / "famous_quotes_100.json"
    data = json.loads(quote_file.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert len(data) == 100
    assert all(isinstance(item, str) and item.strip() for item in data)


def test_local_quote_rotation_returns_content():
    deepseek_client._quote_cache = ["q1", "q2", "q3", "q4"]
    deepseek_client._quote_index = 0

    q1 = deepseek_client._next_quote()
    q2 = deepseek_client._next_quote()
    q3 = deepseek_client._next_quote()
    q4 = deepseek_client._next_quote()
    q5 = deepseek_client._next_quote()

    assert [q1, q2, q3, q4, q5] == ["q1", "q2", "q3", "q4", "q1"]


def test_quote_endpoints_use_local_source():
    client = TestClient(app)

    one_resp = client.post("/api/v1/quotes/famous", json={"text": "test"})
    assert one_resp.status_code == 200
    one_body = one_resp.json()
    assert one_body["source"] == "local_json"
    assert one_body["model"] == "local-json-100"
    assert isinstance(one_body["quote"], str) and one_body["quote"]

    top3_resp = client.post("/api/v1/quotes/famous/top3", json={"text": "test"})
    assert top3_resp.status_code == 200
    top3_body = top3_resp.json()
    assert top3_body["source"] == "local_json"
    assert top3_body["model"] == "local-json-100"
    assert isinstance(top3_body["quotes"], list)
    assert len(top3_body["quotes"]) == 3
