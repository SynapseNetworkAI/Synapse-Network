import json
import os
import time
from typing import Any, Dict

from fastapi import HTTPException
from web3.exceptions import TransactionNotFound

from .common import get_expected_price
from .settings import (
    ALLOWED_TOKEN_ADDRESSES,
    MIN_CONFIRMATIONS,
    PAYMENT_TIMEOUT_MESSAGE,
    PAYMENT_TTL_SEC,
    ROUTER_ADDRESS,
    SELLER_ADDRESS,
)
from .state import lock, pending_first_seen, used_payment_keys, w3


def get_or_set_first_seen(tx_hash: str) -> float:
    with lock:
        if tx_hash not in pending_first_seen:
            pending_first_seen[tx_hash] = time.time()
        return pending_first_seen[tx_hash]


def is_timed_out(first_seen: float) -> bool:
    return (time.time() - first_seen) > PAYMENT_TTL_SEC


def get_receipt_or_pending(tx_hash: str, first_seen: float):
    try:
        tx_receipt = w3.eth.get_transaction_receipt(tx_hash)
    except TransactionNotFound:
        if is_timed_out(first_seen):
            raise HTTPException(status_code=408, detail={"code": "PAYMENT_TIMEOUT", "message": PAYMENT_TIMEOUT_MESSAGE})
        return None
    if tx_receipt is None and is_timed_out(first_seen):
        raise HTTPException(status_code=408, detail={"code": "PAYMENT_TIMEOUT", "message": PAYMENT_TIMEOUT_MESSAGE})
    return tx_receipt


def require_confirmed_success(tx_receipt: Any, first_seen: float) -> int:
    if tx_receipt["status"] != 1:
        raise HTTPException(status_code=402, detail={"code": "PAYMENT_FAILED", "message": "Transaction failed on chain"})
    latest_block = w3.eth.block_number
    confirmations = max(0, latest_block - tx_receipt["blockNumber"] + 1)
    if confirmations < MIN_CONFIRMATIONS:
        if is_timed_out(first_seen):
            raise HTTPException(status_code=408, detail={"code": "PAYMENT_TIMEOUT", "message": PAYMENT_TIMEOUT_MESSAGE})
        return -1
    return confirmations


def load_router_contract():
    abi_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "A2APaySyncRouterABI.json")
    if not os.path.exists(abi_path):
        raise HTTPException(status_code=500, detail={"code": "CONFIG_ERROR", "message": "A2APaySyncRouterABI.json missing"})
    with open(abi_path, "r", encoding="utf-8") as file:
        router_abi = json.load(file)
    return w3.eth.contract(address=w3.to_checksum_address(ROUTER_ADDRESS), abi=router_abi)


def find_matching_service_paid(tx_receipt: Any, expected_service_id: str):
    router_contract = load_router_contract()
    service_paid_events = router_contract.events.ServicePaid().process_receipt(tx_receipt)
    if not service_paid_events:
        raise HTTPException(status_code=402, detail={"code": "NO_SERVICE_PAID", "message": "No ServicePaid event found"})
    for event in service_paid_events:
        args = event["args"]
        if args["seller"].lower() == SELLER_ADDRESS.lower() and args["serviceId"] == expected_service_id:
            return event
    raise HTTPException(status_code=403, detail={"code": "PAYMENT_MISMATCH", "message": "Seller or serviceId does not match"})


def validate_event_policy(event: Any, expected_service_id: str):
    expected_price = get_expected_price(expected_service_id)
    if event["amount"] < expected_price:
        raise HTTPException(status_code=402, detail={"code": "INSUFFICIENT_AMOUNT", "message": "Payment amount insufficient"})
    if ALLOWED_TOKEN_ADDRESSES and event["token"].lower() not in ALLOWED_TOKEN_ADDRESSES:
        raise HTTPException(status_code=403, detail={"code": "TOKEN_NOT_ALLOWED", "message": "Token not allowed"})


def consume_payment_proof_or_conflict(tx_hash: str, matched_event: Any, expected_service_id: str):
    payment_key = f"{tx_hash}:{matched_event.get('logIndex', 0)}:{expected_service_id}"
    with lock:
        if payment_key in used_payment_keys:
            raise HTTPException(status_code=409, detail={"code": "REPLAY_DETECTED", "message": "Payment proof already consumed"})
        used_payment_keys.add(payment_key)
        pending_first_seen.pop(tx_hash, None)


def verify_payment(tx_hash: str, expected_service_id: str) -> Dict[str, Any]:
    if not tx_hash or not tx_hash.startswith("0x") or len(tx_hash) != 66:
        raise HTTPException(status_code=402, detail={"code": "INVALID_TX_HASH", "message": "Invalid tx hash format"})

    first_seen = get_or_set_first_seen(tx_hash)
    tx_receipt = get_receipt_or_pending(tx_hash, first_seen)
    if tx_receipt is None:
        return {"status": "pending"}

    confirmations = require_confirmed_success(tx_receipt, first_seen)
    if confirmations < 0:
        return {"status": "pending"}

    matched_event = find_matching_service_paid(tx_receipt, expected_service_id)
    event = matched_event["args"]
    validate_event_policy(event, expected_service_id)
    consume_payment_proof_or_conflict(tx_hash, matched_event, expected_service_id)

    return {
        "status": "verified",
        "txHash": tx_hash,
        "serviceId": expected_service_id,
        "confirmations": confirmations,
        "amount": int(event["amount"]),
        "fee": int(event["fee"]) if "fee" in event else 0,
    }
