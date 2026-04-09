"""Agent 凭据全生命周期示例: 签发 → 链上支付 → 调用服务 → 撤销

完整演示:
  1. Owner 钱包签名登录（EIP-191 challenge/verify）
  2. 签发 Agent Credential（设置有效期、最大调用次数、RPM 限速）
  3. 链上 Mint USDC + Approve + payForService（模拟充值）
  4. 用 Credential 调用 Gateway generate（带重试轮询）
  5. 撤销 Credential

环境变量:
    OWNER_PRIVATE_KEY      (必填) Owner 钱包私钥
    SERVICE_ID             (必填) 要调用的服务 ID
    PROVIDER_ADDRESS       (必填) Provider 钱包地址
    API_BASE               Gateway API 地址，默认 http://127.0.0.1:8000
    RPC_URL                链 RPC 地址，默认 http://127.0.0.1:8545
    DEPLOYER_PRIVATE_KEY   部署者私钥（用于 mint），默认 Hardhat #0
    OWNER_PAYMENT_PRIVATE_KEY  付款钱包私钥，默认同 OWNER_PRIVATE_KEY
    PRICE_USDC             单次支付金额，默认 1
    PROMPT                 调用提示词
    EXPIRES_IN_SEC         凭据有效期（秒），默认 3600
    MAX_CALLS              凭据最大调用次数，默认 100
    RPM                    每分钟请求限制，默认 600

使用方式:
    export OWNER_PRIVATE_KEY=0x... SERVICE_ID=svc_xxx PROVIDER_ADDRESS=0x...
    python credential_issue_invoke_revoke.py
"""

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


# ── 默认私钥: Hardhat 本地测试链的预置账户 ──
DEFAULT_DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEFAULT_OWNER_PAYMENT_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
CONTENT_TYPE_JSON = "application/json"


def load_json(file_path: Path) -> Any:
    """读取 JSON 文件并返回解析结果。"""
    with file_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def build_auth_headers(token: str, owner_address: str, with_json: bool = True) -> Dict[str, str]:
    """构建认证请求头: Authorization Bearer + X-User-Address。"""
    headers = {
        "Authorization": f"Bearer {token}",
        "X-User-Address": owner_address,
    }
    if with_json:
        headers["Content-Type"] = CONTENT_TYPE_JSON
    return headers


def authenticate_owner(api_base: str, owner_private_key: str) -> tuple[str, str]:
    """执行 EIP-191 钱包签名登录。

    流程: GET /auth/challenge 获取随机 nonce → 钱包签名 → POST /auth/verify 换取 JWT token。
    返回 (token, owner_address)。
    """
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
    provider_address: str,
    price_usdc: str,
    deployer_private_key: str,
    owner_payment_private_key: str,
) -> str:
    """链上支付全流程: Mint USDC → Approve → payForService。

    1. 用 deployer 给付款钱包铸造测试 USDC
    2. 付款钱包授权 SynapseCore 合约花费 USDC
    3. 调用 payForService 完成链上支付
    返回交易哈希 (txHash)。
    """
    contract_config = load_json(root_dir / "frontend" / "src" / "contract-config.json")
    router_abi = load_json(root_dir / "frontend" / "src" / "SynapseCoreABI.json")
    usdc_abi = load_json(root_dir / "frontend" / "src" / "MockUSDCABI.json")

    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise RuntimeError(f"Cannot connect RPC: {rpc_url}")

    chain_id = int(web3.eth.chain_id)
    router_address = Web3.to_checksum_address(contract_config["SynapseCore"])
    token_address = Web3.to_checksum_address(contract_config["MockUSDC"])
    provider_checksum = Web3.to_checksum_address(provider_address)

    deployer = web3.eth.account.from_key(deployer_private_key)
    payer = web3.eth.account.from_key(owner_payment_private_key)

    usdc_contract = web3.eth.contract(address=token_address, abi=usdc_abi)
    router_contract = web3.eth.contract(address=router_address, abi=router_abi)

    amount_wei = web3.to_wei(price_usdc, "ether")

    try:
        mint_nonce = web3.eth.get_transaction_count(deployer.address)
        mint_tx = usdc_contract.functions.mint(payer.address, amount_wei).build_transaction(
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
        print(f"[payment] minted owner payment USDC: {mint_hash.hex()}")
    except Exception as error:
        print(f"[payment] mint skipped/failed (continue): {error}")

    approve_nonce = web3.eth.get_transaction_count(payer.address)
    approve_tx = usdc_contract.functions.approve(router_address, amount_wei).build_transaction(
        {
            "from": payer.address,
            "nonce": approve_nonce,
            "chainId": chain_id,
            "gas": 200000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    approve_signed = payer.sign_transaction(approve_tx)
    approve_hash = web3.eth.send_raw_transaction(approve_signed.raw_transaction)
    web3.eth.wait_for_transaction_receipt(approve_hash)
    print(f"[payment] approve done: {approve_hash.hex()}")

    pay_nonce = web3.eth.get_transaction_count(payer.address)
    pay_tx = router_contract.functions.payForService(token_address, provider_checksum, amount_wei, service_id).build_transaction(
        {
            "from": payer.address,
            "nonce": pay_nonce,
            "chainId": chain_id,
            "gas": 400000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    pay_signed = payer.sign_transaction(pay_tx)
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
    """调用 Gateway generate 接口，支持 202 重试轮询。

    当 Gateway 返回 202 时表示付款尚未确认，等待 retryAfterSec 后重试，
    直到成功或超时。
    """
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
    """读取必填环境变量，缺失时抛出异常。"""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing env: {name}")
    return value


def main() -> None:
    """主流程: 登录 → 签发凭据 → 链上支付 → 调用服务 → 撤销凭据。"""
    service_id = require_env("SERVICE_ID")
    provider_address = require_env("PROVIDER_ADDRESS")

    deployer_private_key = os.getenv("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_PRIVATE_KEY)
    owner_payment_private_key = os.getenv(
        "OWNER_PAYMENT_PRIVATE_KEY",
        owner_private_key or DEFAULT_OWNER_PAYMENT_PRIVATE_KEY,
    )

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
        f"{api_base}/api/v1/credentials/agent/issue",
        headers=build_auth_headers(token, owner_address),
        json={
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
        provider_address=provider_address,
        price_usdc=price_usdc,
        deployer_private_key=deployer_private_key,
        owner_payment_private_key=owner_payment_private_key,
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
        f"{api_base}/api/v1/credentials/agent/{credential_id}/revoke",
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
