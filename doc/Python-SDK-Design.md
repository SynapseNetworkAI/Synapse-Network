# AgentPay Python SDK 设计与实现文档 (Phase 2)

## 1. 设计初衷 (Motivation)
目前的主流 AI Agent 框架（如 LangChain, AutoGen, CrewAI 等）均基于 Python 开发。为了让这些 AI 在遇到需要“花钱解决问题”的场景时（例如：请求外部高阶模型 API、购买推特发帖权限、购买爬虫数据集），能够**自主、无缝地完成链上支付**，我们需要封装一个 Python Web3 SDK。

该 SDK 会隐藏复杂的区块链交互（RPC、Nonce、Gas预估、ABI解析），对外暴露出最极简的语义。

## 2. 核心架构 (Architecture)

```text
[ Python AI Agent ]  <--->  [ AgentPay SDK ]  <--->  [ RPC Node (Base/Hardhat) ]  <--->  [ Smart Contracts ]
(🧠 决策: 需调外部服务)       (📦 组装交易 & 签名)         (🌐 广播交易)                     (🔒 Escrow & ERC20)
```

**关键组件：**
1. **Wallet Manager**: 管理赋予 Agent 的 Session Key（本地临时私钥），执行离线签名。
2. **USDC Wrapper**: 处理代币相关的授权（Approve）与余额查询（Balance）。
3. **Escrow Client**: 对接 `AgentPayEscrow` 合约，进行 `lockFunds` (锁仓付款) 与 `releaseFunds` (确认收货放款)。

## 3. 核心 API 设计 (Core Methods)

```python
class AgentPayClient:
    def __init__(self, private_key: str, rpc_url: str, escrow_addr: str, usdc_addr: str):
        """初始化客户端，挂载身份和合约"""

    def get_balance(self) -> float:
        """获取当前 Agent 拥有的 USDC 余额"""

    def approve_escrow(self, amount: float) -> str:
        """[内部步骤] 授权担保合约扣款"""
        
    def lock_funds(self, task_id: str, seller_address: str, amount: float) -> str:
        """买家 Agent 发起担保支付，将资金锁定在 Escrow 中"""

    def release_funds(self, task_id: str) -> str:
        """买家 Agent 拿到结果，验证成功后，释放资金给卖家"""
```

## 4. 依赖 (Dependencies)
- `web3>=6.0.0` (以太坊官方 Python 交互库)
- `eth-account` (用于本地私钥签名)