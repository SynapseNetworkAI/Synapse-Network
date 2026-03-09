from threading import Lock
from typing import Any, Dict, List

from web3 import Web3

from .settings import RPC_URL

w3 = Web3(Web3.HTTPProvider(RPC_URL))
lock = Lock()
used_payment_keys = set()
pending_first_seen: Dict[str, float] = {}
auth_challenges: Dict[str, Dict[str, Any]] = {}
rate_limit_windows: Dict[str, List[float]] = {}
