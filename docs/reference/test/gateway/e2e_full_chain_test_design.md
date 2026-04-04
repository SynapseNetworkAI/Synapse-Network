# Synapse Network — 完整链路自动化测试方案设计

> 文档路径：`docs/test/gateway/e2e_full_chain_test_design.md`  
> 更新日期：2026-04-02  
> 适用环境：本地 (`environment=local`)，可扩展至 staging

---

## 1. 测试目标

验证从"冷启动"到"链上充值 → 凭据调用链上结算"的完整主干链路：

| # | 步骤 | 验证的核心不变量 |
|---|------|----------------|
| 1 | 启动基础设施（Hardhat / Anvil + Postgres + Redis + Gateway） | 所有服务健康响应 |
| 2 | 钱包注册 / Auth Challenge-Verify | 获得有效 JWT |
| 3 | 链上发币 + 转账 ETH/USDC 到测试钱包 | 钱包余额可用 |
| 4 | `depositWithPermit` / `deposit` 上链 + 通知 Gateway | Gateway 链下余额 = depositAmount |
| 5 | Provider 注册服务 | `serviceId` 可被 Discovery 返回 |
| 6 | 创建 Agent Credential | 凭据 token 可用 |
| 7 | Quote → Invocation 调用链 | 结算后 owner 余额减少 = 服务定价 |
| 8 | 状态断言 + 清理 | 无残留数据影响下次运行 |

---

> 说明：这份文档是 **consumer paid invocation 主干链路**。  
> 如果你要验证 `http://localhost:3000/provider/services/deploy` 对应的真实 Provider 接入流程，请看：
> `docs/06_Reference/test/gateway/provider_service_deploy_e2e_test_design.md`

---

## 2. 系统架构与服务依赖

```
┌─────────────────────────────────────────────────────────────────┐
│  Test Runner (Python / pytest)                                   │
│                                                                 │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │ Hardhat  │   │  PostgreSQL  │   │       Redis           │    │
│  │ / Anvil  │   │  :5432       │   │       :6379           │    │
│  │ :8545    │   └──────────────┘   └──────────────────────┘    │
│  └──────────┘                                                   │
│       │                                                         │
│  ┌────▼─────────────────────────────────────────────────────┐   │
│  │  Gateway (FastAPI)  :8000                                │   │
│  │  POST /v1/auth/challenge  /v1/auth/verify                │   │
│  │  POST /v1/balance/deposit/intent                         │   │
│  │  POST /v1/balance/deposit/confirm                        │   │
│  │  POST /v1/services/register                              │   │
│  │  POST /v1/credentials/agent/issue                        │   │
│  │  POST /v1/agent/quotes                                   │   │
│  │  POST /v1/agent/invocations                              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Provider Service (FastAPI)  :8001                       │   │
│  │  GET  /health                                            │   │
│  │  POST /provider-services/{slug}/invoke                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 关键合约（本地部署）

| 合约 | 地址来源 | 作用 |
|------|----------|------|
| `SynapseCore` | `apps/frontend/src/contract-config.json["SynapseCore"]` | Owner 充值 / 提现金库 |
| `MockUSDC` | `contract-config.json["MockUSDC"]` | 测试用稳定币，`mint()` 无权限控制 |

### 2.2 测试账号约定（Hardhat 默认私钥）

| 角色 | 私钥 | 说明 |
|------|------|------|
| `DEPLOYER` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` | Hardhat #0，合约部署者，可调用 `MockUSDC.mint()` |
| `OWNER` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` | Hardhat #1，充值用户 / Agent Credential 持有者 |
| `PROVIDER` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ecf` | Hardhat #2，Provider 注册钱包 |

> **安全提示**：上述私钥仅用于 localhost Hardhat/Anvil 测试网。禁止在任何公共网络或生产集群中使用。

---

## 3. 测试框架选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 测试框架 | `pytest` + `pytest-asyncio` | 与 Gateway Python 生态一致 |
| HTTP 客户端 | `httpx` (async) | 支持异步 + 完整响应断言 |
| 链交互 | `web3.py` | 已在 gateway 依赖中 |
| 签名 | `eth-account` | EIP-191 消息签名 / EIP-712 Permit |
| 配置注入 | `pytest fixtures` + `conftest.py` | 跨测试文件共享服务 URL、私钥、token |
| 断言 | `pytest.raises` + `assert` + `decimal.Decimal` | 精度安全比较 |
| 测试数据隔离 | 每次运行生成新 agent name UUID | 避免残留数据冲突 |

**文件结构：**

```
gateway/tests/e2e/
├── conftest.py                  # 全局 fixture：服务地址、合约配置、账号
├── helpers/
│   ├── __init__.py
│   ├── auth.py                  # authenticate_wallet() helper
│   ├── chain.py                 # mint_usdc(), deposit_on_chain(), get_balance()
│   └── gateway.py               # deposit_intent(), deposit_confirm(), issue_credential()
├── test_01_infrastructure.py    # Step 1: 服务健康检查
├── test_02_wallet_auth.py       # Step 2: Challenge-Verify 流程
├── test_03_fund_wallet.py       # Step 3: 链上 ETH + USDC 发币
├── test_04_deposit.py           # Step 4: 充值全链路
├── test_05_provider_register.py # Step 5: Provider 注册服务
├── test_06_agent_credential.py  # Step 6: 创建 Agent Credential
├── test_07_invoke.py            # Step 7: Quote → Invocation → 余额核对
└── test_08_cleanup.py           # Step 8: 状态清理
```

---

## 4. 环境变量 / conftest.py 配置

```python
# gateway/tests/e2e/conftest.py
import json, pytest
from pathlib import Path
from web3 import Web3

ROOT = Path(__file__).parents[3]   # 仓库根
CONTRACT_CONFIG = ROOT / "apps/frontend/src/contract-config.json"

# ── 服务端点 ──────────────────────────────────────────────────────────
GATEWAY_BASE   = "http://127.0.0.1:8000"
PROVIDER_BASE  = "http://127.0.0.1:8001"
RPC_URL        = "http://127.0.0.1:8545"

# ── 测试账号（Hardhat 默认）────────────────────────────────────────────
DEPLOYER_KEY  = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
OWNER_KEY     = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PROVIDER_KEY  = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ecf"

@pytest.fixture(scope="session")
def contract_config():
    with CONTRACT_CONFIG.open() as f:
        return json.load(f)

@pytest.fixture(scope="session")
def w3():
    return Web3(Web3.HTTPProvider(RPC_URL))

@pytest.fixture(scope="session")
def deployer_account(w3):
    return w3.eth.account.from_key(DEPLOYER_KEY)

@pytest.fixture(scope="session")
def owner_account(w3):
    return w3.eth.account.from_key(OWNER_KEY)

@pytest.fixture(scope="session")
def provider_account(w3):
    return w3.eth.account.from_key(PROVIDER_KEY)
```

---

## 5. 各步骤详细设计

### Step 1 — 基础设施健康检查

**文件：** `test_01_infrastructure.py`

**前置条件：**  
运行 `scripts/local/setup_local_env.sh`（部署合约，写入 `contract-config.json`）  
运行 `scripts/local/restart_gateway.sh`（启动 Gateway）  
启动 Provider Service：`cd provider_service && uvicorn app.main:app --port 8001`

**测试用例：**

```python
import httpx, pytest

def test_gateway_health():
    r = httpx.get("http://127.0.0.1:8000/health", timeout=5)
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") in ("ok", "healthy", "running")

def test_provider_health():
    r = httpx.get("http://127.0.0.1:8001/health", timeout=5)
    assert r.status_code == 200

def test_hardhat_rpc(w3):
    assert w3.is_connected()
    block = w3.eth.block_number
    assert isinstance(block, int) and block >= 0

def test_contract_config_exists(contract_config):
    assert "SynapseCore"  in contract_config
    assert "MockUSDC"     in contract_config
```

---

### Step 2 — 钱包注册 / Auth 登录

**流程：**

```
GET  /api/v1/auth/challenge?address={owner_address}
  → { challenge: "...", message: "...", domain: "a2a-pay-network" }

客户端用 eth_sign / personal_sign 对 message 签名

POST /api/v1/auth/verify
  Body: { wallet_address, signature, message }
  → { access_token, token_type: "bearer", expires_in }
```

**测试用例（`test_02_wallet_auth.py`）：**

```python
import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

GATEWAY = "http://127.0.0.1:8000"
OWNER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

def test_wallet_auth_full_flow():
    account = Account.from_key(OWNER_KEY)
    address = account.address.lower()

    # 1. 获取 challenge
    r = httpx.get(f"{GATEWAY}/api/v1/auth/challenge", params={"address": address})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    message = data["challenge"]  # or data["message"]

    # 2. 签名
    signed = Account.sign_message(encode_defunct(text=message), private_key=OWNER_KEY)

    # 3. 验证签名 → 获得 token
    r2 = httpx.post(f"{GATEWAY}/api/v1/auth/verify", json={
        "wallet_address": address,
        "signature": signed.signature.hex(),
        "message": message,
    })
    assert r2.status_code == 200
    token_data = r2.json()
    assert token_data["success"] is True
    assert token_data["access_token"]
    assert token_data["token_type"] == "bearer"

    # 4. 重复登录（幂等）
    r3 = httpx.get(f"{GATEWAY}/api/v1/auth/challenge", params={"address": address})
    assert r3.status_code == 200
```

**断言重点：**
- `access_token` 非空字符串
- `401` 不出现在正常流程
- 伪造签名返回 `401`（负面用例）

---

### Step 3 — 链上发币 & 转账 ETH/USDC

**前置：** Hardhat/Anvil 节点已运行，MockUSDC 已部署

**操作序列：**

```python
# helpers/chain.py
from decimal import Decimal
from web3 import Web3

USDC_DECIMALS = 18   # MockUSDC 精度（本地与真实 USDC 6位不同，需确认）

def mint_usdc(w3, usdc_contract, deployer, recipient: str, amount_usdc: Decimal):
    """Deployer 调用 MockUSDC.mint()，向 recipient 铸造测试 USDC"""
    amount_wei = int(amount_usdc * 10**USDC_DECIMALS)
    nonce = w3.eth.get_transaction_count(deployer.address)
    tx = usdc_contract.functions.mint(
        Web3.to_checksum_address(recipient), amount_wei
    ).build_transaction({
        "from": deployer.address, "nonce": nonce,
        "chainId": w3.eth.chain_id,
        "gas": 200_000, "gasPrice": w3.eth.gas_price,
    })
    signed = deployer.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1, f"mint failed: {tx_hash.hex()}"
    return tx_hash.hex()

def fund_eth(w3, from_account, to_address: str, amount_eth: Decimal):
    """向测试地址转 ETH（用于支付 gas）"""
    nonce = w3.eth.get_transaction_count(from_account.address)
    tx_hash = w3.eth.send_transaction({
        "from": from_account.address,
        "to": Web3.to_checksum_address(to_address),
        "value": w3.to_wei(amount_eth, "ether"),
        "nonce": nonce,
        "gas": 21_000,
        "gasPrice": w3.eth.gas_price,
    })
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt["status"] == 1
    return tx_hash.hex()
```

**测试用例（`test_03_fund_wallet.py`）：**

```python
from decimal import Decimal

FUND_USDC = Decimal("100")   # 充值给 owner 的 USDC
FUND_ETH  = Decimal("1")     # 充值给 owner 的 ETH

def test_mint_usdc_to_owner(w3, contract_config, deployer_account, owner_account):
    usdc_addr = Web3.to_checksum_address(contract_config["MockUSDC"])
    # 加载 ABI（简要版，仅 mint + balanceOf）
    usdc = w3.eth.contract(address=usdc_addr, abi=MOCK_USDC_ABI)
    tx = mint_usdc(w3, usdc, deployer_account, owner_account.address, FUND_USDC)
    assert tx.startswith("0x")
    bal = usdc.functions.balanceOf(owner_account.address).call()
    assert bal >= int(FUND_USDC * 10**18)

def test_fund_eth_to_owner(w3, deployer_account, owner_account):
    before = w3.eth.get_balance(owner_account.address)
    fund_eth(w3, deployer_account, owner_account.address, FUND_ETH)
    after = w3.eth.get_balance(owner_account.address)
    assert after > before
```

---

### Step 4 — 充值全链路（链上 deposit → Gateway 同步）

**充值三步协议：**

```
① Owner 调用 SynapseCore.deposit(amount)  ← 链上 tx
② POST /api/v1/balance/deposit/intent
     Body: { txHash, amountUsdc }
     → { eventKey }
③ POST /api/v1/balance/deposit/confirm
     Body: { eventKey, confirmations: 1 }
     → { success: true, newBalance }
```

**测试用例（`test_04_deposit.py`）：**

```python
from decimal import Decimal
DEPOSIT_USDC = Decimal("10")

def test_deposit_full_pipeline(
    w3, contract_config, owner_account, owner_jwt, gateway_headers
):
    # ① 链上 approve + deposit
    router_addr  = Web3.to_checksum_address(contract_config["SynapseCore"])
    usdc_addr    = Web3.to_checksum_address(contract_config["MockUSDC"])
    usdc         = w3.eth.contract(address=usdc_addr, abi=MOCK_USDC_ABI)
    router       = w3.eth.contract(address=router_addr, abi=SYNAPSE_CORE_ABI)
    amount_wei   = int(DEPOSIT_USDC * 10**18)

    # approve
    approve_tx = usdc.functions.approve(router_addr, amount_wei).build_transaction({
        "from": owner_account.address,
        "nonce": w3.eth.get_transaction_count(owner_account.address),
        "chainId": w3.eth.chain_id, "gas": 100_000, "gasPrice": w3.eth.gas_price,
    })
    signed = owner_account.sign_transaction(approve_tx)
    w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(signed.raw_transaction))

    # deposit
    deposit_tx = router.functions.deposit(amount_wei).build_transaction({
        "from": owner_account.address,
        "nonce": w3.eth.get_transaction_count(owner_account.address),
        "chainId": w3.eth.chain_id, "gas": 150_000, "gasPrice": w3.eth.gas_price,
    })
    signed2 = owner_account.sign_transaction(deposit_tx)
    receipt  = w3.eth.wait_for_transaction_receipt(
        w3.eth.send_raw_transaction(signed2.raw_transaction)
    )
    assert receipt["status"] == 1
    tx_hash = receipt["transactionHash"].hex()

    # ② intent
    r = httpx.post(
        f"{GATEWAY}/api/v1/balance/deposit/intent",
        headers=gateway_headers,
        json={"txHash": tx_hash, "amountUsdc": float(DEPOSIT_USDC)},
    )
    assert r.status_code == 200
    event_key = r.json()["eventKey"]

    # ③ confirm
    r2 = httpx.post(
        f"{GATEWAY}/api/v1/balance/deposit/confirm",
        headers=gateway_headers,
        json={"eventKey": event_key, "confirmations": 1},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["success"] is True

    # ④ 余额断言
    r3 = httpx.get(f"{GATEWAY}/api/v1/balance", headers=gateway_headers)
    assert r3.status_code == 200
    balance = Decimal(str(r3.json()["balance"]))
    assert balance >= DEPOSIT_USDC, f"expected >= {DEPOSIT_USDC}, got {balance}"
```

**关键断言：**
- `receipt.status == 1`（链上成功）
- `/v1/balance` 返回余额 ≥ 充值金额
- 重复提交相同 `txHash` 返回幂等成功 or `409`（视实现而定）

---

### Step 5 — Provider 注册服务

**API：**

```
POST /api/v1/services/register
Headers: Authorization: Bearer {provider_jwt}
         X-User-Address: {provider_address}
Body: {
  "agentToolName": "svc_e2e_test_sentiment",
  "serviceName": "E2E Test Sentiment",
  "role": "Provider",
  "status": "active",
  "isActive": true,
  "pricing": { "amount": "0.001", "currency": "USDC" },
  "summary": "E2E integration test service",
  "tags": ["e2e", "test"],
  "auth": { "type": "gateway_signed" },
  "invoke": {
    "targets": [{ "url": "http://127.0.0.1:8001" }]
  },
  "healthCheck": {
    "path": "/health",
    "method": "GET",
    "timeoutMs": 3000,
    "successCodes": [200]
  },
  "payoutAccount": {
    "payoutAddress": "{provider_address}",
    "chainId": 31337,
    "settlementCurrency": "USDC"
  },
  "governance": {
    "termsAccepted": true,
    "riskAcknowledged": true
  }
}
```

**测试用例（`test_05_provider_register.py`）：**

```python
import uuid

SERVICE_SLUG = f"svc_e2e_{uuid.uuid4().hex[:8]}"

def test_provider_registers_service(provider_jwt_headers, provider_account):
    r = httpx.post(
        f"{GATEWAY}/api/v1/services/register",
        headers=provider_jwt_headers,
        json={
            "agentToolName": SERVICE_SLUG,
            "serviceName": f"E2E Test {SERVICE_SLUG}",
            "role": "Provider",
            "status": "active",
            "isActive": True,
            "pricing": {"amount": "0.001", "currency": "USDC"},
            "summary": "Automated e2e test service",
            "tags": ["e2e"],
            "auth": {"type": "gateway_signed"},
            "invoke": {"targets": [{"url": "http://127.0.0.1:8001"}]},
            "healthCheck": {
                "path": "/health", "method": "GET",
                "timeoutMs": 3000, "successCodes": [200],
            },
            "payoutAccount": {
                "payoutAddress": provider_account.address.lower(),
                "chainId": 31337,
                "settlementCurrency": "USDC",
            },
            "governance": {"termsAccepted": True, "riskAcknowledged": True},
        },
    )
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body.get("serviceId") or body.get("id"), "serviceId missing from response"

def test_service_discoverable(provider_jwt_headers):
    r = httpx.get(
        f"{GATEWAY}/api/v1/services/discover",
        params={"intent": "e2e"},
    )
    assert r.status_code == 200
    services = r.json().get("services", [])
    found = [s for s in services if SERVICE_SLUG in str(s.get("agentToolName", ""))]
    assert found, f"Service {SERVICE_SLUG} not found in discovery results"
```

---

### Step 6 — 创建 Agent Credential

**API：**

```
POST /api/v1/credentials/agent/issue
Headers: Authorization: Bearer {owner_jwt}
         X-User-Address: {owner_address}
Body: {
  "name": "e2e-test-agent",
  "maxCalls": 100,
  "creditLimit": 5.0,
  "rpm": 60
}
→ { credential_id, token, ... }
```

**测试用例（`test_06_agent_credential.py`）：**

```python
def test_issue_agent_credential(owner_jwt_headers):
    r = httpx.post(
        f"{GATEWAY}/api/v1/credentials/agent/issue",
        headers=owner_jwt_headers,
        json={
            "name": "e2e-test-agent",
            "maxCalls": 100,
            "creditLimit": 5.0,
            "rpm": 60,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("credential_id") or body.get("id")
    assert body.get("token"), "token field missing"
    return body["token"]

def test_list_credentials_contains_issued(owner_jwt_headers):
    r = httpx.get(f"{GATEWAY}/api/v1/credentials/agent/list", headers=owner_jwt_headers)
    assert r.status_code == 200
    creds = r.json().get("credentials", [])
    names = [c.get("name") for c in creds]
    assert "e2e-test-agent" in names
```

---

### Step 7 — Quote → Invocation → 余额核对（核心链路）

**完整调用链：**

```
POST /api/v1/agent/quotes
  Headers: X-Credential: {agent_token}
  Body: { "serviceId": "{service_id}", "responseMode": "sync" }
  → { quoteId, price, currency, expiresAt }

POST /api/v1/agent/invocations
  Headers: X-Credential: {agent_token}
  Body: {
    "quoteId": "{quote_id}",
    "idempotencyKey": "{uuid}",
    "payload": { "prompt": "e2e test sentiment" },
    "responseMode": "sync"
  }
  → { invocationId, status, result, billedAmount }

GET /api/v1/agent/invocations/{invocationId}
  Headers: X-Credential: {agent_token}
  → receipt with finalStatus
```

**测试用例（`test_07_invoke.py`）：**

```python
import uuid
from decimal import Decimal

def test_full_invoke_chain_and_balance(
    owner_jwt_headers, agent_token, service_id, gateway_headers
):
    # 调用前余额
    balance_before = get_gateway_balance(gateway_headers)

    # Quote
    r_quote = httpx.post(
        f"{GATEWAY}/api/v1/agent/quotes",
        headers={"X-Credential": agent_token},
        json={"serviceId": service_id, "responseMode": "sync"},
    )
    assert r_quote.status_code == 200, r_quote.text
    quote = r_quote.json()
    quote_id = quote["quoteId"]
    price    = Decimal(str(quote["price"]))
    assert quote_id and price > 0

    # Invocation
    idem_key = uuid.uuid4().hex
    r_inv = httpx.post(
        f"{GATEWAY}/api/v1/agent/invocations",
        headers={"X-Credential": agent_token},
        json={
            "quoteId": idem_key,          # quoteId 或 idempotencyKey 视 API 版本而定
            "idempotencyKey": idem_key,
            "payload": {"prompt": "e2e automated test"},
            "responseMode": "sync",
        },
        timeout=30,
    )
    assert r_inv.status_code == 200, r_inv.text
    inv_body = r_inv.json()
    inv_id   = inv_body.get("invocationId") or inv_body.get("id")
    assert inv_id

    # Receipt 确认
    r_receipt = httpx.get(
        f"{GATEWAY}/api/v1/agent/invocations/{inv_id}",
        headers={"X-Credential": agent_token},
    )
    assert r_receipt.status_code == 200
    receipt = r_receipt.json()
    assert receipt.get("status") in ("completed", "success", "accepted")

    # 余额扣减断言（精度用 Decimal，允许 ±0.001 误差应对浮点累积）
    balance_after = get_gateway_balance(gateway_headers)
    deducted = balance_before - balance_after
    assert abs(deducted - price) <= Decimal("0.001"), \
        f"expected deduction={price}, actual={deducted}"

# 幂等性测试：相同 idempotencyKey 重复提交 → 相同 invocationId
def test_invocation_idempotency(agent_token, service_id):
    idem_key = uuid.uuid4().hex
    payload  = {"serviceId": service_id, "responseMode": "sync"}

    def invoke():
        return httpx.post(
            f"{GATEWAY}/api/v1/agent/invocations",
            headers={"X-Credential": agent_token},
            json={**payload, "idempotencyKey": idem_key,
                  "payload": {"prompt": "idempotent test"}},
            timeout=30,
        )

    r1 = invoke()
    r2 = invoke()
    assert r1.status_code == r2.status_code == 200
    assert r1.json().get("invocationId") == r2.json().get("invocationId")
```

---

### Step 8 — 状态断言 & 清理

**测试用例（`test_08_cleanup.py`）：**

```python
def test_revoke_credential(owner_jwt_headers, issued_credential_id):
    r = httpx.post(
        f"{GATEWAY}/api/v1/credentials/agent/{issued_credential_id}/revoke",
        headers=owner_jwt_headers,
    )
    assert r.status_code == 200

def test_revoked_credential_blocked(agent_token, service_id):
    r = httpx.post(
        f"{GATEWAY}/api/v1/agent/quotes",
        headers={"X-Credential": agent_token},
        json={"serviceId": service_id, "responseMode": "sync"},
    )
    assert r.status_code in (401, 403), "revoked credential must be rejected"

def test_delete_test_service(provider_jwt_headers, registered_service_id):
    r = httpx.delete(
        f"{GATEWAY}/api/v1/services/{registered_service_id}",
        headers=provider_jwt_headers,
    )
    assert r.status_code in (200, 204)
```

---

## 6. Fixture 依赖图

```
session
 └── contract_config ─────────────────────────┐
 └── w3 ──────────────────────────────────────┤
 └── deployer_account ──────────────────────── │
 └── owner_account ──────────────────────────  │
 └── provider_account ─────────────────────── │
                                               ▼
function / module                         owner_jwt  ────► owner_jwt_headers
                                          provider_jwt ──► provider_jwt_headers
                                          agent_token  ──► (Step 7)
                                          service_id   ──► (Step 7)
```

所有 `jwt` / `token` / `service_id` 通过 `pytest.fixture(scope="module")` 在步骤间传递，避免重复 HTTP 请求。

---

## 7. 启动脚本方案

在测试目录新建 `run_e2e.sh`，一键完成服务启动 + 测试运行 + 收尾：

```bash
#!/usr/bin/env bash
# gateway/tests/e2e/run_e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "[1/4] Deploy local contracts (Hardhat)"
cd "$ROOT" && bash scripts/local/setup_local_env.sh

echo "[2/4] Start Gateway"
bash scripts/local/restart_gateway.sh

echo "[3/4] Start Provider Service"
cd "$ROOT/provider_service"
nohup uvicorn app.main:app --host 127.0.0.1 --port 8001 \
  --log-level info > /tmp/provider_e2e.log 2>&1 &
PROVIDER_PID=$!
sleep 3

echo "[4/4] Run E2E tests"
cd "$ROOT/gateway"
source .venv/bin/activate || source venv/bin/activate
pytest tests/e2e/ -v --tb=short --timeout=60

echo "Stopping provider service (PID=$PROVIDER_PID)"
kill "$PROVIDER_PID" || true
```

---

## 8. CI 集成方案（GitHub Actions）

```yaml
# .github/workflows/e2e.yml
name: E2E Full Chain Test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: synapse_gateway
          POSTGRES_USER: synapse
          POSTGRES_PASSWORD: "12345678"
        ports: ["5432:5432"]
      redis:
        image: redis:7
        ports: ["6379:6379"]

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: "20.19.0" }

      - name: Install Foundry
        run: curl -L https://foundry.paradigm.xyz | bash && $HOME/.foundry/bin/foundryup

      - name: Install Python 3.11
        uses: actions/setup-python@v5
        with: { python-version: "3.11" }

      - name: Install gateway deps
        run: pip install -r gateway/requirements.txt

      - name: Deploy contracts + start services
        run: bash scripts/local/setup_local_env.sh

      - name: Run E2E tests
        run: |
          cd gateway
          pytest tests/e2e/ -v --tb=short --timeout=60
        env:
          ENVIRONMENT: local
          RPC_URL: http://127.0.0.1:8545
```

---

## 9. 负面用例清单

| 场景 | 期望状态码 | 验证点 |
|------|-----------|--------|
| 无 token 调用鉴权接口 | 401 | `detail.code == "UNAUTHORIZED"` |
| 伪造签名 verify | 401 | challenge mismatch |
| 余额不足发起 invocation | 402 / 400 | `detail.code == "INSUFFICIENT_BALANCE"` |
| 过期 / 已撤销凭据调用 | 401 / 403 | credential revoked |
| 重复 `txHash` deposit | 200 幂等 或 409 | 余额不重复增加 |
| `deposit` 金额与链上不符 | 400 | `AMOUNT_MISMATCH` |
| 超过 creditLimit 调用 | 429 / 402 | `QUOTA_EXCEEDED` |
| 无效 `quoteId` invocation | 400 / 404 | `QUOTE_NOT_FOUND` |

---

## 10. 已知限制 & 注意事项

1. **MockUSDC 精度**：本地 MockUSDC 为 18 位精度，正式 USDC 为 6 位。测试代码中 `USDC_DECIMALS` 需与合约实际部署参数对齐（可从 `MockUSDC.sol` 读取 `decimals()`）。

2. **Deposit 自动索引**：Gateway 有后台 `deposit_indexer` 任务轮询链上事件。在测试中若使用自动索引而非 intent/confirm 手动流程，需要等待索引延迟（建议 `time.sleep(3)` 或 polling）。

3. **Provider Service 授权**：`/provider-services/{slug}/invoke` 要求请求携带 `X-Gateway-Auth` 签名头（`gateway_signed`），由 Gateway 在 forwarding 层注入，测试中直接通过 Gateway `/v1/agent/invocations` 触发即可，不应绕过直调 Provider。

4. **链上 gas**：Hardhat 默认账号有充足 ETH。若 owner/provider 账号余额不足，先用 deployer 转账（见 Step 3）。

5. **测试隔离**：服务名 `agentToolName` 和 credential name 均加 UUID 后缀，防止并发测试或重跑时冲突。

6. **Anvil vs Hardhat**：两者均可用于本地链。`scripts/local/setup_local_env.sh` 使用 Anvil；如改为 Hardhat node，确保 `anvil` 命令替换为 `npx hardhat node`。

---

## 11. 参考文件索引

| 文件 | 用途 |
|------|------|
| `scripts/local/setup_local_env.sh` | 本地合约部署 + 基础设施启动 |
| `scripts/local/restart_gateway.sh` | Gateway 热重启 |
| `gateway/examples/credential_issue_invoke_revoke.py` | 凭据完整示例（可直接运行） |
| `gateway/examples/register_provider_shelf_services.py` | Provider 注册完整示例 |
| `gateway/examples/agent_sdk_discover_invoke.py` | Discover + 调用示例 |
| `gateway/src/api/routers/auth.py` | Auth API 实现 |
| `gateway/src/api/routers/balance.py` | 充值/余额 API |
| `gateway/src/api/routers/agent_credentials.py` | 凭据 CRUD API |
| `gateway/src/api/routers/forwarding.py` | Quote + Invocation API |
| `gateway/src/api/routers/services.py` | 服务注册 + Discovery API |
| `contracts/SynapseCore.sol` | 链上合约：deposit / withdraw |
| `apps/frontend/src/contract-config.json` | 本地部署合约地址 |
