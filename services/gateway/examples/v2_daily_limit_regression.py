"""V2 每日限额 (Daily Limit) 回归测试

验证流程:
  1. Owner 钱包签名登录
  2. 发现一个服务并获取单价
  3. 签发 Agent Credential
  4. 设置每日限额 = 单次调用价格（只够一次）
  5. 链上充值 + 等待确认
  6. 第一次调用应成功
  7. 第二次调用应被拦截（402 DAILY_LIMIT_EXCEEDED）

环境变量:
    API_BASE               Gateway API 地址，默认 http://127.0.0.1:8000
    RPC_URL                链 RPC 地址，默认 http://127.0.0.1:8545
    OWNER_PRIVATE_KEY      Owner 私钥，默认 Hardhat #0
    DEPLOYER_PRIVATE_KEY   部署者私钥，默认 Hardhat #0
    OWNER_PAYMENT_PRIVATE_KEY 付款私钥，默认同 OWNER_PRIVATE_KEY
    PROMPT                 调用提示词

使用方式:
    python v2_daily_limit_regression.py
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


def authenticate_owner(api_base: str, owner_private_key: str) -> tuple[str, str]:
    """执行 EIP-191 钱包签名登录，返回 (token, owner_address)。"""
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


def build_auth_headers(token: str, owner_address: str, with_json: bool = True) -> Dict[str, str]:
    """构建认证请求头。"""
    headers = {
        "Authorization": f"Bearer {token}",
        "X-User-Address": owner_address,
    }
    if with_json:
        headers["Content-Type"] = CONTENT_TYPE_JSON
    return headers


def pick_target_service(api_base: str) -> tuple[str, float]:
    """从服务发现接口获取第一个可用服务及其单价。"""
    response = requests.get(f"{api_base}/api/v1/services/discover", timeout=20)
    response.raise_for_status()
    payload = response.json()
    services = payload.get("services", [])
    if not services:
        raise RuntimeError("No active services found from /api/v1/services/discover")

    target = services[0]
    service_id = str(target.get("serviceId", "")).strip()
    if not service_id:
        raise RuntimeError("Service discovery returned empty serviceId")

    try:
        unit_price = float(target.get("pricing", 0))
    except Exception as error:
        raise RuntimeError(f"Invalid pricing in discovered service: {error}")

    if unit_price <= 0:
        raise RuntimeError("Discovered service has non-positive pricing")

    return service_id, unit_price


def issue_credential(api_base: str, token: str, owner_address: str) -> str:
    """签发 Agent Credential，返回 credential token。"""
    response = requests.post(
        f"{api_base}/api/v1/credentials/agent/issue",
        headers=build_auth_headers(token, owner_address),
        json={
            "expiresInSec": 3600,
            "maxCalls": 100,
            "rpm": 600,
        },
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    token_value = str(payload.get("credential", {}).get("token", "")).strip()
    if not token_value:
        raise RuntimeError("Failed to issue credential token")
    return token_value


def set_daily_limit(api_base: str, token: str, owner_address: str, daily_limit_usdc: float) -> None:
    """设置账户每日花费限额（USDC）。"""
    response = requests.post(
        f"{api_base}/api/v1/router/config",
        headers=build_auth_headers(token, owner_address),
        json={"dailyLimitUsdc": round(daily_limit_usdc, 6)},
        timeout=20,
    )
    response.raise_for_status()


def build_payment_tx(
    root_dir: Path,
    rpc_url: str,
    service_id: str,
    deposit_amount_usdc: float,
    deployer_private_key: str,
    owner_payment_private_key: str,
    provider_address: Optional[str] = None,
) -> str:
    """链上支付: Mint USDC → Approve → payForService，返回 txHash。"""
    contract_config = load_json(root_dir / "frontend" / "src" / "contract-config.json")
    router_abi = load_json(root_dir / "frontend" / "src" / "SynapseCoreABI.json")
    usdc_abi = load_json(root_dir / "frontend" / "src" / "MockUSDCABI.json")

    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise RuntimeError(f"Cannot connect RPC: {rpc_url}")

    chain_id = int(web3.eth.chain_id)
    router_address = Web3.to_checksum_address(contract_config["SynapseCore"])
    token_address = Web3.to_checksum_address(contract_config["MockUSDC"])

    deployer = web3.eth.account.from_key(deployer_private_key)
    payer = web3.eth.account.from_key(owner_payment_private_key)
    provider_checksum = Web3.to_checksum_address(provider_address or deployer.address)

    usdc_contract = web3.eth.contract(address=token_address, abi=usdc_abi)
    router_contract = web3.eth.contract(address=router_address, abi=router_abi)

    amount_wei = web3.to_wei(str(deposit_amount_usdc), "ether")

    mint_nonce = web3.eth.get_transaction_count(deployer.address)
    mint_tx = usdc_contract.functions.mint(payer.address, amount_wei).build_transaction(
        {
            "from": deployer.address,
            "nonce": mint_nonce,
            "chainId": chain_id,
            "gas": 250000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    mint_signed = deployer.sign_transaction(mint_tx)
    mint_hash = web3.eth.send_raw_transaction(mint_signed.raw_transaction)
    web3.eth.wait_for_transaction_receipt(mint_hash)

    approve_nonce = web3.eth.get_transaction_count(payer.address)
    approve_tx = usdc_contract.functions.approve(router_address, amount_wei).build_transaction(
        {
            "from": payer.address,
            "nonce": approve_nonce,
            "chainId": chain_id,
            "gas": 250000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    approve_signed = payer.sign_transaction(approve_tx)
    approve_hash = web3.eth.send_raw_transaction(approve_signed.raw_transaction)
    web3.eth.wait_for_transaction_receipt(approve_hash)

    pay_nonce = web3.eth.get_transaction_count(payer.address)
    pay_tx = router_contract.functions.payForService(
        token_address,
        provider_checksum,
        amount_wei,
        service_id,
    ).build_transaction(
        {
            "from": payer.address,
            "nonce": pay_nonce,
            "chainId": chain_id,
            "gas": 500000,
            "gasPrice": web3.eth.gas_price,
        }
    )
    pay_signed = payer.sign_transaction(pay_tx)
    pay_hash = web3.eth.send_raw_transaction(pay_signed.raw_transaction)
    web3.eth.wait_for_transaction_receipt(pay_hash)

    tx_hash = pay_hash.hex()
    if not tx_hash.startswith("0x"):
        tx_hash = f"0x{tx_hash}"
    return tx_hash


def submit_and_wait_deposit_confirmation(
    api_base: str,
    token: str,
    owner_address: str,
    tx_hash: str,
    amount_usdc: float,
    timeout_sec: int = 90,
) -> None:
    """提交充值意图并轮询等待确认。

    持续查询 deposit intents 列表，直到对应 txHash 状态变为 confirmed。
    """
    intent_resp = requests.post(
        f"{api_base}/api/v1/balance/deposit/intent",
        headers=build_auth_headers(token, owner_address),
        json={
            "txHash": tx_hash,
            "amountUsdc": round(amount_usdc, 6),
        },
        timeout=20,
    )
    intent_resp.raise_for_status()

    started_at = time.time()
    last_state: Optional[Dict[str, Any]] = None
    while True:
        list_resp = requests.get(
            f"{api_base}/api/v1/balance/deposit/intents?limit=50",
            headers=build_auth_headers(token, owner_address, with_json=False),
            timeout=20,
        )
        list_resp.raise_for_status()
        rows = list_resp.json().get("intents", [])

        target = next((row for row in rows if str(row.get("txHash", "")).lower() == tx_hash.lower()), None)
        if target:
            last_state = target
            status = str(target.get("status", "")).lower()
            if status == "confirmed":
                return
            if status in {"failed", "duplicate"}:
                raise RuntimeError(f"Deposit intent ended with status={status}: {target}")

        if time.time() - started_at > timeout_sec:
            raise TimeoutError(
                f"Timed out waiting for deposit confirmation. last_state={last_state}. "
                "Please ensure backend indexer is running and ROUTER_ADDRESS matches deployed SynapseCore."
            )
        time.sleep(2)


def invoke_v2_generate(api_base: str, credential: str, service_id: str, prompt: str) -> requests.Response:
    """调用 Gateway generate 接口（单次，不轮询）。"""
    return requests.post(
        f"{api_base}/api/v1/gateway/generate",
        headers={
            "Content-Type": CONTENT_TYPE_JSON,
            "X-Credential": credential,
            "X-Service-Id": service_id,
        },
        json={"prompt": prompt, "serviceId": service_id},
        timeout=30,
    )


def main() -> None:
    """主流程: 7 步验证 daily limit 是否正常拦截第二次调用。"""
    root_dir = Path(__file__).resolve().parents[2]

    api_base = os.getenv("API_BASE", "http://127.0.0.1:8000").rstrip("/")
    rpc_url = os.getenv("RPC_URL", "http://127.0.0.1:8545")

    owner_private_key = os.getenv("OWNER_PRIVATE_KEY", DEFAULT_DEPLOYER_PRIVATE_KEY)
    deployer_private_key = os.getenv("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_PRIVATE_KEY)
    owner_payment_private_key = os.getenv(
        "OWNER_PAYMENT_PRIVATE_KEY",
        owner_private_key or DEFAULT_OWNER_PAYMENT_PRIVATE_KEY,
    )
    prompt = os.getenv("PROMPT", "daily limit regression check")

    print("[1/7] Authenticate owner...")
    auth_token, owner_address = authenticate_owner(api_base, owner_private_key)

    print("[2/7] Discover service...")
    service_id, unit_price = pick_target_service(api_base)
    print(f"      service_id={service_id}, unit_price={unit_price}")

    print("[3/7] Issue credential...")
    credential_token = issue_credential(api_base, auth_token, owner_address)

    print("[4/7] Set daily limit equal to one call price...")
    set_daily_limit(api_base, auth_token, owner_address, unit_price)

    deposit_amount = max(unit_price * 3, 3.0)
    print(f"[5/7] Build on-chain payment tx and submit deposit intent (amount={deposit_amount})...")
    tx_hash = build_payment_tx(
        root_dir=root_dir,
        rpc_url=rpc_url,
        service_id=service_id,
        deposit_amount_usdc=deposit_amount,
        deployer_private_key=deployer_private_key,
        owner_payment_private_key=owner_payment_private_key,
    )
    print(f"      tx_hash={tx_hash}")

    submit_and_wait_deposit_confirmation(
        api_base=api_base,
        token=auth_token,
        owner_address=owner_address,
        tx_hash=tx_hash,
        amount_usdc=deposit_amount,
    )

    print("[6/7] First call should succeed...")
    first_resp = invoke_v2_generate(api_base, credential_token, service_id, prompt)
    first_resp.raise_for_status()
    print(f"      first_status={first_resp.status_code}")

    print("[7/7] Second call should be blocked by daily limit...")
    second_resp = invoke_v2_generate(api_base, credential_token, service_id, prompt)
    if second_resp.status_code != 402:
        raise RuntimeError(f"Expected 402 for second call, got {second_resp.status_code}: {second_resp.text}")

    body = second_resp.json()
    code = str(body.get("detail", {}).get("code", ""))
    if code != "DAILY_LIMIT_EXCEEDED":
        raise RuntimeError(f"Expected DAILY_LIMIT_EXCEEDED, got: {second_resp.text}")

    print("PASS: daily limit enforcement is working (second call blocked).")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}")
        sys.exit(1)
