# 后端架构与数据隔离设计方案 (Backend Isolation Design)

基于 A2A-Pay 的前端与合约账户隔离机制，后端 (Python FastAPI + Indexer) 作为连接前端与区块链的中间件，必须在代码与数据存储层面严格贯彻**零托管 (Non-custodial)** 和**行列级数据隔离 (Row-Level Security)** 原则。

本文档定义了 Python SDK/Indexer 端的程序隔离设计规范。

## 1. 后端安全与信任边界

* **只读与验证为主**：后端主要负责同步链上数据 (Indexer) 和下发组装的交易参数，**绝对不负责拼接或代替用户签名涉及主账户资金的交易**。
* **绝对零私钥托管**：数据库中**绝对不允许**出现用户的 MetaMask 主发资金钱包私钥。
* **以 Web3 签名为真理**：所有敏感 API 请求，必须带有基于 EOA 地址的加密签名 (EIP-712/EIP-191) 或由此派生颁发的短期 JWT Tokens。

---

## 2. 接口权限路由门卫设计 (API Gateway Guards)

为了匹配前端双面板隔离与智能合约资金隔离的业务诉求，FastAPI 后端的路由组 (Routers) 分为三个独立的命名空间，对应不同的鉴权拦截器 (Dependencies)：

### 2.1 `/api/dashboard/*` (平台普通用户 API)
* **定位**：提供给用户 Dashboard 浏览器前端调用的接口。
* **鉴权门卫 (`verify_user_session`)**：前端在首次登录时，使用 MetaMask 钱包对一条带 Nonce 的消息进行签名，后端利用 `eth_account.messages` 校验恢复出 `ownerAddress`，并下发只包含该地址身份的 JWT。
* **强制数据隔离策略 (Row-level)**：所有针对 Agent 资源的 CRUD（如获取 Agent 列表），在数据库查询阶段必须被强制塞入 `ownerAddress` 作为过滤条件：
  ```python
  WHERE owner_address = {current_jwt_user_address}
  ```

### 2.2 `/api/admin/*` (系统管理员 API)
* **定位**：提供给 Protocol Admin 面板调用的接口 (Gods View)。
* **多因素鉴权门卫 (`verify_admin_session`)**：
  1. **地址/凭证白名单校验**：只允许配置或环境变量指定的管理员账户请求。
  2. **动态 OTP 校验**：诸如修改基础费率、执行全局统计的核心接口，其 HTTP Header 中必须同时携带当前时间窗口的 6 位 TOTP (由前端输入 Google Authenticator 生成传输)。
* **隔离策略**：Admin 拥有读取全局宏观统计数据 (`select count(*) count from transactions`) 的权限，但 API 层面**拒绝并屏蔽任何修改单个具体用户资金、修改具体 Agent 记录属性的接口**。

### 2.3 `/api/agent/*` (独立 Agent 客户端接口)
* **定位**：提供给跑在用户服务器终端的 Python AI 脚本调用的接口，一般为拉取商品目录、组装 Escrow 支付标的物数据等。
* **签名门卫 (`verify_agent_signature`)**：不依赖 JWT，由 Agent 内置的“受限零钱包私钥 (Session Key)”作为身份凭证，并在发送 HTTP 调用时，以 EIP-191 对整个 Request Body 签名进行不可抵赖断言。
* **隔离策略**：由于该接口调用方仅拥有小额权限，此网关**仅允许触发支付询问流程**相关的路由。由于其缺少 `ownerAddress` （冷主钱包）特权，网关拦截任何尝试从系统或合约发起提款动作或越权读取其他兄弟网络节点数据的企图。

---

## 3. 数据库模型隔离设计 (ORM Design)

数据库表结构在设计时，围绕双向关系实现硬隔离机制。以 SQLAlchemy 模型为例：

```python
from sqlalchemy import Column, String, Numeric, DateTime, ForeignKey
from database import Base

class Agent(Base):
    __tablename__ = 'agents'

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    
    # ---------------- 身份与管理权限隔离的核心字段 ----------------
    # 标识该 AI 属于哪一个主钱包 (Web 端 Dashboard 用户) 
    owner_address = Column(String, index=True, nullable=False) 
    
    # ---------------- 资金与执行层面隔离的核心字段 ----------------
    # Agent自身的零钱包(以太坊公钥地址)，对应 AgentSmartWallet 
    agent_session_wallet = Column(String, unique=True, nullable=False) 
    
    status = Column(String, default="active")
    created_at = Column(DateTime)

class Transaction(Base):
    __tablename__ = 'transactions'
    
    tx_hash = Column(String, primary_key=True)
    # 流水直接绑定由哪个执行器(Agent钱包)触发产生
    agent_address = Column(String, ForeignKey('agents.agent_session_wallet'))
    amount = Column(Numeric)
```

**安全性查询落地：**
当业务逻辑需要涉及查询/更新修改某用户下面的 Agent 数据时：

```python
# ❌ 错误/危险写法 (容易收到 ID 遍历越权攻击, 又称 BOLA)
agent = db.query(Agent).filter(Agent.id == request_agent_id).first()

# ✅ 安全隔离的写法 (强制带入请求上下文的上下文宿主签名地址)
agent = db.query(Agent).filter(
    Agent.id == request_agent_id,
    Agent.owner_address == current_user_address.lower() # 行级隔离基石
).first()
```

---

## 4. 后端防越权与灾难隔离总结
1. **防止 BOLA (越权攻击)**：依靠 ORM 查询及路由门卫强制绑定 `owner_address`，即便黑客恶意遍历 Agent ID，如果不使用受害者 MetaMask 的签名，也无法查询或篡改该记录。
2. **影响面降级 (Blast Radius Reduction)**：
   - 如果此 FastAPI 后端的数据库遭遇“拖库”，由于数据库中只存储用户公开的冷钱包公钥以及链上能查到的 Agent 热钱包，**没有任何私钥存储在中心化库中**，黑客无法窃取用户的主力本金。
   - 如果前端的 Admin 后台被暴力破解获取了常规验证字串，由于后端的 `AdminGuard` 强校验 OTP 算法二次签发码，黑客同样无法进入特权模式进行系统级参数修改。
---

## 5. 项目实际落地实现纪要 (FastAPI & SQLAlchemy)

在目前的项目代码中，后端隔离机制已通过以下代码模块正式落地：

### 5.1 HTTP 请求鉴权拦截中间件 (`auth.py`)
利用 FastAPI 的 `Header` 与 `Depends` 特性，截获前端请求带入的 Web3 身份签名信息（当前阶段通过 `X-User-Address` 透传）：
* **路径**: `python_sdk/indexer/c_api/auth.py`
* **处理逻辑**: `verify_client_session` 函数会校验当前请求是否合法，提取出 `X-User-Address` 并强制转换为 lowercase（消除大小写敏感问题），向后级路由暴露当前真实的冷钱包 `owner_address` 以供 RLS 过滤。如果未提供即视为无身份，触发 `401 Unauthorized` 阻断。

### 5.2 路由层与数据库 Row-Level Security (`routes.py`)
在所有的用户数据查询和变更接口中应用强制的数据归属权校验，实现了行级安全（Row-Level Security）。
* **路径**: `python_sdk/indexer/c_api/routes.py`
* **实现亮点**:
  1. **防止 BOLA (越权查询)**：如获取 Agent 列表 (`/api/client/agents`) 强制要求 `.filter(AgentModel.owner_address == owner_address)`。
  2. **双边查询准入约束**：如查询交易流水 (`/api/client/tasks`)，先验证请求查询的那个 Agent 是否属于来访者 (`owner_address`)，确保了哪怕知晓其他人的 Agent ID，也由于所属主钱包不匹配引发 `403 Forbidden`。
  3. **强制属主写入**：新建 Agent POST 请求中，不受信任的前端无法伪造归属人，新建对象直接绑定由 `verify_client_session` 返回的只读态 `owner_address`。
