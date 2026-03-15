# 网关离链计费与凭票退款结算设计 (Gateway Off-chain Billing & Refund Design)

本文档详细说明了 Synapse Network 在引入 `SynapseCore.sol` (V2 架构) 后，Python 后端网关如何完成**“离链高频切账”**以及**“凭票清算（赛博银票 EIP-712）”**的完整实现方案。

这套方案完全摒弃了老旧的 Web3 逐笔上链模式，真正做到了：**只有存钱和取钱时用户需要在链上按确认（付极少的 Gas），中间成千上万次的极快 API 调用体验极度丝滑（和 Web2 一样快，和 Web2 一样免费）**。

## 1. 核心数据结构 (离链账本 DB)

在 Python 后端网关（Gateway）中，系统主要维护以下三个核心状态集合（可持久化在 Redis / JSON / DB 中）：

### 1.1 Service Registry (服务目录)
记录 Seller 注册的 AI 服务与**单次调用定价**。
* `service_id`: 服务全局唯一标识 (如 `SVC_DEMO`)
* `seller_address`: 拥有该服务的卖家钱包地址
* `price_per_call`: 该 API 单次调用的定价 (例如 0.005 USDC)
* `target_url`: 卖家真实的物理 API 地址

### 1.2 Agent Credentials (访问密钥)
记录买家授权生成的访问凭证，映射到具体钱包。
* `credential_id`: HTTP Header 中携带的 X-Agent-Credential (Bearer 令牌)
* `buyer_address`: 此令牌关联的买家链上地址
* `expires_at`: 令牌过期时间

### 1.3 Balance Ledger (离链财务大账)
这是整个离链结算的核心表：
* `buyerBalances`: 记录买家在 Vault 中充值但尚未消耗的可用余额的映射。
* `sellerReceivables`: 记录卖家提供服务赚取但尚未上链提现的余额。
* `platformFeeAccrued`: 网关扣费时截留到系统里的待提现平台手续费池。

---

## 2. 网关秒级扣费逻辑 (核心主链路)

当买家携带 `X-Agent-Credential` 和请求体打向网关入口 `http://网关/api/v1/gateway/generate` 时，Python 中间件执行以下极速鉴权与切账：

### Step 1: 身份与余额前置校验
1. 解析并验证 `Credential`，提取对应的 `buyer_address`。
2. 根据请求附带的 `X-Service-Id` 从 `Service Registry` 读取出当前调用的单价 `price_per_call`。
3. 检查离链账本：`buyerBalances[buyer_address] >= price_per_call`。若余额不足，直接阻断业务并返回 `HTTP 402 Payment Required`。

### Step 2: 透明流量转发 (Reverse Proxy)
网关作为反向代理，将用户的 Prompt 和载荷透传至 Seller 真实的服务器 (`target_url`) 并等待结果返回。

### Step 3: 毫秒级记账分润 (Accounting)
若 Seller API 成功返回结果 (如 HTTP 200)，Python 网关立刻对账本对象进行**内存级切账**：
1. **买家扣减**: `buyerBalances[buyer_address] -= price_per_call`
2. **平台抽成计算**: `platform_cut = price_per_call * 0.01` (例如 1% 平台过路费)
3. **卖家进账**: `sellerReceivables[seller_address] += (price_per_call - platform_cut)`
4. **抽水入池**: `platformFeeAccrued += platform_cut`

*(注：上述四大步骤全在 Python 内存或数据库层以 UPDATE/加减法形式完成，不发送任何区块链网络交易，0 chain Gas！)*

### Step 4: 返回结果
将 Seller 提供的数据透传回给买家客户端，本次微支付周期落幕。

---

## 3. 买家退款与赛博银票签发机制 (出金流)

当买家不想再使用，且其离线账本表中还剩余一定 USDC（比如 15 U 此前已经全部充进了 `SynapseCore.sol`）时，出金（Refund）流程遵循“由平台发票，用户自己提现”策略：

### Step 1: 用户在前端发起退款请求
前端调用网关专用接口: `POST /api/v1/refund`

### Step 2: Python 网关结算出票账本
1. 查出用户可用全额: `refundable_amount = buyerBalances[buyer_address]`
2. 为防止双花及重放攻击，将网关数据库中该用户的余额**清零锁定**: `buyerBalances[buyer_address] = 0`。

### Step 3: 后端开出“赛博银票” (EIP-712 Signature)
后端调用密码学库（如 `eth-account`），利用最高管理者的热钱包私钥 (`platformSigner`的私钥)：
* 构造智能合约兼容的 Domain 结构 (匹配名称 `"SynapseCore"`, 版本 `"2"`, 还有对应的 `chainId` 及合约地址)。
* 拼装提款消息: 确认提款人 (`owner` = `buyer_address`)，金额 (`amount` = `refundable_amount`)，手续费 (`fee` = 0，退款豁免)，防重放 Nonce（通过 RPC 向智能合约查此人的 nonce），以及过期时间 `deadline`。
* 组合以上要素并本地签署后产生 `v, r, s` (转化为十六进制 signature，附加其余数据打包 HTTP 返回给前端)。

### Step 4: 前端拿着签名“金库取现” (智能合约闭环)
收到 HTTP 回包后，前端使用 wagmi 直接调用 MetaMask。
* 直接将 `amount`, `fee`, `nonce`, `deadline`, `signature` 参数一把传给链上金库 `SynapseCore.withdraw`。
* 智能合约 ecrecover 验证确认是平台签发后，顺手提取 fee 到平台池（若 fee>0），剩余金额直接原路打给用户。**所需 Gas 由提款用户自行支付。**

*(卖家提取营收 `Seller Claim` 的流程与理发大同小异，只是出账对象变为 `sellerReceivables` 且大概率会附带大于 0 的提币手续费做平台抽水的变现转移)。*

---

## 4. 关键 Python 签名实现参考 (EIP-712)

Python 网关中执行签署的伪代码参考实现（FastAPI 中）：

```python
from eth_account.messages import encode_typed_data
from eth_account import Account
import time

def sign_withdraw_ticket(user_address: str, amount_wei: int, fee_wei: int, nonce: int, vault_contract_address: str, chain_id: int, signer_private_key: str):
    """
    为前端生成可以向智能合约 SynapseCore 请求取款的授权签名
    """
    domain = {
        "name": "SynapseCore",
        "version": "2",
        "chainId": chain_id, 
        "verifyingContract": vault_contract_address
    }

    message = {
        "user": user_address,
        "amount": amount_wei,
        "fee": fee_wei,
        "nonce": nonce,
        "deadline": int(time.time()) + 3600 # 银票有效期默认1小时
    }

    types = {
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"}
        ],
        "Withdraw": [
            {"name": "user", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "fee", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint256"}
        ]
    }

    signer_acct = Account.from_key(signer_private_key)
    
    # EIP-712 打包
    signable_msg = encode_typed_data(domain_data=domain, message_types=types, message_data=message)
    signed_message = signer_acct.sign_message(signable_msg)

    # 返回组装好准备上链的数据集
    return {
        "amount": amount_wei,
        "fee": fee_wei,
        "nonce": nonce,
        "deadline": message["deadline"],
        "signature": signed_message.signature.hex()
    }
```
