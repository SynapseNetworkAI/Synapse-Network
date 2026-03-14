# pyright: reportMissingImports=false

import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src.storage.json_impl import JsonStorage  # noqa: E402


@pytest.fixture()
def temp_json_storage():
    with TemporaryDirectory() as tmp:
        yield JsonStorage(directory=tmp)
