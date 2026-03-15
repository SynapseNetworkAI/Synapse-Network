import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3


DEFAULT_DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEFAULT_BUYER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
CONTENT_TYPE_JSON = "application/json"


def load_json(file_path: Path) -> Any:
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def build_auth_headers(token: str, owner_address: str, with_json: bool = True) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "X-User-Address": owner_address,
    }
    if with_json:
        headers["Content-Type"] = CONTENT_TYPE_JSON
    return headers


def authenticate_owner(api_base: str, owner_private_key: str) -> tuple[str, str]:
    owner_account = Account.from_key(owner_private_key)
    owner_address = owner_account.address.lower()

    challenge_resp = requests.get(
        f"{api_base}/api/v1/auth/challenge",
        params={"address": owner_address},
        timeout=20,
    )
    challenge_resp.raise_for_status()
    challenge = challenge_resp.json()

    signed_message = Account.sign_message(
        encode_defunct(text=challenge["message"]),
        private_key=owner_private_key,
    )

    verify_resp = requests.post(
        f"{api_base}/api/v1/auth/verify",
        headers={"Content-Type": CONTENT_TYPE_JSON},
        json={
            "address": owner_address,
            "nonce": challenge["nonce"],
            "signature": signed_message.signature.hex(),
        },
        timeout=20,
    )
    verify_resp.raise_for_status()
    verified = verify_resp.json()
    return verified["token"], owner_address


def mint_and_pay_for_service(
    root_dir: Path,
    rpc_url: str,
    service_id: str,
    seller_address: str,
    price_usdc: str,
    deployer_private_key: str,
    buyer_private_key: str,
) -> str:
    contract_config = load_json(root_dir / "frontend" / "src" / "contract-config.json")
    router_abi = load_json(root_dir / "frontend" / "src" / "A2APaySyncRouterABI.json")
    usdc_abi = load_json(root_dir / "frontend" / "src" / "MockUSDCABI.json")

    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise RuntimeError(f"Cannot connect RPC: {rpc_url}")

    chain_id = int(web3.eth.chain_id)
    router_address = Web3.to_checksum_address(contract_config["A2APaySyncRouter"])
    token_address = Web3.to_checksum_address(contract_config["MockUSDC"])
    seller_checksum = Web3.to_checksum_address(seller_address)

    deployer = web3.eth.account.from_key(deployer_private_key)
    buyer = web3.eth.account.from_key(buyer_private_key)

    usdc_contract = web3.eth.contract(address=token_address, abi=usdc_abi)
    router_contract = web3.eth.contract(address=router_address, abi=router_abi)

    amount_wei = web3.to_wei(price_usdc, "ether")

    try:
        mint_nonce = web3.eth.get_transaction_count(deployer.address)
        mint_tx = usdc_contract.functions.mint(buyer.address, amount_wei).build_transaction(
            {
                "from": deployer.address,
                "nonce": mint_nonce,
                "chainId": chain_id,
                "gas": 200000,
                "gasPrice": web3.eth.gas_price,
            }
        )
        mint_signed = deployer.sign_transaction(mint_tx)
        mint_hash = web3.eth.send_raw_transaction(mint_signed.raw_transaction)
        web3.eth.wait_for_transaction_receipt(mint_hash)
        print(f"[payment] minted buyer USDC: {mint_hash.hex()}")
    except Exception as error:
        print(f"[payment] mint skipped/failed (continue): {error}")

    approve_nonce = web3.eth.get_transaction_count(buyer.address)
    approve_tx = usdc_contract.functions.approve(router_address, amount_wei).build_transaction(
        {
            "from": buyer.address,
            "nonce": approve_nonce,
            "chainId": chain_id,
            "gas": 200000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    approve_signed = buyer.sign_transaction(approve_tx)
    approve_hash = web3.eth.send_raw_transaction(approve_signed.raw_transaction)
    web3.eth.wait_for_transaction_receipt(approve_hash)
    print(f"[payment] approve done: {approve_hash.hex()}")

    pay_nonce = web3.eth.get_transaction_count(buyer.address)
    pay_tx = router_contract.functions.payForService(token_address, seller_checksum, amount_wei, service_id).build_transaction(
        {
            "from": buyer.address,
            "nonce": pay_nonce,
            "chainId": chain_id,
            "gas": 400000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    pay_signed = buyer.sign_transaction(pay_tx)
    pay_hash = web3.eth.send_raw_transaction(pay_signed.raw_transaction)
    web3.eth.wait_for_transaction_receipt(pay_hash)

    tx_hash = pay_hash.hex()
    print(f"[payment] payForService done: {tx_hash}")
    return tx_hash


def invoke_generate_with_polling(
    api_base: str,
    service_id: str,
    credential_token: str,
    prompt: str,
    timeout_sec: int = 90,
) -> Dict[str, Any]:
    started_at = time.time()

    while True:
        response = requests.post(
            f"{api_base}/api/v1/gateway/generate",
            headers={
                "Content-Type": CONTENT_TYPE_JSON,
                "X-Service-Id": service_id,
                "X-Credential": credential_token,
            },
            json={"prompt": prompt, "serviceId": service_id},
            timeout=40,
        )

        if response.status_code == 202:
            body = response.json()
            retry_after = int(body.get("retryAfterSec", 2))
            if time.time() - started_at + retry_after > timeout_sec:
                raise TimeoutError("generate pending timeout")
            print(f"[invoke] pending, retry in {retry_after}s ...")
            time.sleep(retry_after)
            continue

        response.raise_for_status()
        return response.json()


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing env: {name}")
    return value


def main() -> None:
    root_dir = Path(__file__).resolve().parents[2]

    api_base = os.getenv("API_BASE", "http://127.0.0.1:8000").rstrip("/")
    rpc_url = os.getenv("RPC_URL", "http://127.0.0.1:8545")

    owner_private_key = require_env("OWNER_PRIVATE_KEY")
    service_id = require_env("SERVICE_ID")
    seller_address = require_env("SELLER_ADDRESS")

    deployer_private_key = os.getenv("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_PRIVATE_KEY)
    buyer_private_key = os.getenv("BUYER_PRIVATE_KEY", DEFAULT_BUYER_PRIVATE_KEY)

    price_usdc = os.getenv("PRICE_USDC", "1")
    prompt = os.getenv("PROMPT", "hello from credential script")
    expires_in_sec = int(os.getenv("EXPIRES_IN_SEC", "3600"))
    max_calls = int(os.getenv("MAX_CALLS", "100"))
    rpm = int(os.getenv("RPM", "600"))

    print("[step] owner auth ...")
    token, owner_address = authenticate_owner(api_base, owner_private_key)
    print(f"[auth] owner={owner_address}")

    print("[step] issue credential ...")
    issue_resp = requests.post(
        f"{api_base}/api/v1/credentials/issue",
        headers=build_auth_headers(token, owner_address),
        json={
            "serviceId": service_id,
            "expiresInSec": expires_in_sec,
            "maxCalls": max_calls,
            "rpm": rpm,
        },
        timeout=30,
    )
    issue_resp.raise_for_status()
    issued = issue_resp.json()["credential"]
    credential_id = issued["id"]
    credential_token = issued["token"]
    print(f"[credential] issued id={credential_id}")

    print("[step] payForService to get tx hash ...")
    mint_and_pay_for_service(
        root_dir=root_dir,
        rpc_url=rpc_url,
        service_id=service_id,
        seller_address=seller_address,
        price_usdc=price_usdc,
        deployer_private_key=deployer_private_key,
        buyer_private_key=buyer_private_key,
    )

    print("[step] invoke /generate with credential ...")
    generate_result = invoke_generate_with_polling(
        api_base=api_base,
        service_id=service_id,
        credential_token=credential_token,
        prompt=prompt,
    )
    print("[invoke] success payload:")
    print(json.dumps(generate_result, indent=2, ensure_ascii=False))

    print("[step] revoke credential ...")
    revoke_resp = requests.post(
        f"{api_base}/api/v1/credentials/{credential_id}/revoke",
        headers=build_auth_headers(token, owner_address, with_json=False),
        timeout=20,
    )
    revoke_resp.raise_for_status()
    print(f"[credential] revoked id={credential_id}")

    print("\nDONE: issue -> invoke -> revoke complete")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}")
        sys.exit(1)
