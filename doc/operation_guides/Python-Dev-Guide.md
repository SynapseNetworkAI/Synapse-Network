# A2A-Pay Python 后端与 SDK 运维启动指南 (Operation Guide)

本文档说明如何从零开始配置环境、安装依赖，并启动 A2A-Pay 的 Python 网关服务（Indexer & APIs）、OSS 存储底座与相关 SDK 组件。

## 0. 前置依赖：启动辅助基础设施 (极其重要)

### 0.1 启动本地区块链节点
因为所有的后台监听服务（Indexer）与前端界面均高度依赖以太坊 RPC 节点，进行本地开发前，**必须优先启动本地的 Hardhat 运行环境**。如果没有启动，您将会在启动后端服务或前端发起请求时遇到如下网络拒接报错：
`POST http://127.0.0.1:8545/ net::ERR_CONNECTION_REFUSED`

请在**项目根目录**（A2A-pay）打开一个新的终端窗口并执行：
```bash
# 1. 安装根目录的智能合约与开发依赖（如尚未安装）
npm install

# 2. 启动本地区块链测试网（默认运行在 127.0.0.1:8545，请保持此终端窗口一直开启）
npx hardhat node
```

*(如果您是首次启动，还需要再开一个终端运行合约部署脚本，以将协议和 Token 部署到本地测试网)*:
```bash
npx hardhat run scripts/deploy.js --network localhost
```

### 0.2 启动本地 OSS 对象存储服务 (MinIO)
在 AI Agent 处理任务的过程中（如 Seller 进行图片渲染、数据分析结果的投递），经常会产生极大的 Payload，此时完全依赖链上或数据库会导致拥堵。
因此我们使用 **MinIO** 作为本地的离线大文件存储服务器（完全兼容 AWS S3 协议）。

请使用项目根目录下的 `docker-compose.yml` 启动 OSS 服务：

```bash
# 在 A2A-pay 根目录下执行
docker-compose up -d
```

**服务启动说明：**
* 启动成功后，MinIO 的 API 服务将运行在：`http://127.0.0.1:9000` (用于 Python boto3 SDK 交互)
* **Web UI 控制台** 将运行在：`http://127.0.0.1:9001`
* **默认账号**: `admin`
* **默认密码**: `password`

*(注意：在您的 Seller Agent 代码向网关回传大型数据链接前，请先在这个后台面板创建一个 Public 可视的 bucket，如 `a2a-payloads`)*。

确保节点与 OSS 控制台正常运行后，再继续以下步骤启动 Python 服务：

## 1. 环境准备

本服务基于 Python 开发，推荐使用 Python 3.9+ 环境。
在开始之前，确保您已经在项目根目录，并切入了 `python_sdk` 文件夹：

```bash
cd python_sdk
```

### 创建与激活虚拟环境 (Virtual Environment)
为防止依赖冲突，强烈建议创建隔离的虚拟环境：

**Mac/Linux:**
```bash
# 创建虚拟环境
python3 -m venv venv
# 激活环境
source venv/bin/activate
```

**Windows:**
```bash
python -m venv venv
.\venv\Scripts\activate
```

## 2. 安装依赖包
项目涉及两大块基础依赖：
1. `Web3.py`, `Langchain` 等位于根 `requirements.txt`。
2. API 网关所需的 `FastAPI`, `Uvicorn`, `SQLAlchemy` 位于 `indexer/requirements.txt`。

执行以下命令一键安装所有所需依赖：
```bash
pip install -r requirements.txt
pip install -r indexer/requirements.txt
```

*(可选) 如果遇到某些加密库缺少 C++ 编译环境，请确保已安装 `build-essential` (Linux) 或 Xcode 命令行工具 (Mac)。*

## 3. 环境变量配置
复制环境变量配置模板，并填入相应的配置：
```bash
cp .env.example .env
```
此时根据需连接的链（如果在本地则默认是 Hardhat 本地网）与 OpenAI keys 进行相关配置。如果是本地测试网无需修改。

## 4. 启动微服务 (API 网关)
该目录中的核心网络服务由 `FastAPI` 构建，并在架构上为了完全隔离普通用户（Dashboard/Client）与管理员（Protocol Admin）分为双独立进程启动。

您可以使用我们提供的脚本一次性同时拉起两端 API 网关及链上轮询同步守护进程（Sync Daemon）：

```bash
# 给予脚本执行权限（仅初次配置需要）
chmod +x run_services.sh

# 启动服务
./run_services.sh
```

**观察启动日志：**
* **Client API** 将运行在: `http://localhost:8000` (为 Dashboard 提供鉴权/Agent 创建与数据 Row-Level 查询隔离)。
* **Admin API** 将运行在: `http://localhost:8001` (为神之视角 God Mode 面板提供全局独立路由与宏观数据)。

*按下 `Ctrl+C` 即可同时优雅停止这两个服务。*

## 5. 常规调试与 SDK 运行测试
当网关服务正在运行时，如果您想测试或执行本目录下独立的 Python AI Agent 支付脚本（如基于 LangChain 编排的 A2A 自动议价）：

**重新打开一个新的终端窗口：**
```bash
cd python_sdk
source venv/bin/activate

# 运行 Agent A2A 交易 Demo
python demo_agent.py

# 运行全链路多 Agent 自动议价 Demo
python multi_agent_negotiation.py
```

## 6. 清理与重置数据库状态
Indexer 会自动监听链上的 Escrow 合约事件并把流水写进 SQLite 本地库(`indexer_client.db`, `indexer_admin.db`)。
如果在此期间重启了本地的 Hardhat 网重置了区块高度，你可以直接删除 sqlite 本地文件来清空状态，服务下次重启时会自动重建数据表：
```bash
rm *.db
```
然后再次 `./run_services.sh` 即可获得一个清新的后端状态。

## 7. 测试与验证 Marketplace 流程与 SDK
项目中提供了 `marketplace_client.py` SDK 客户端封装，以及 `test_marketplace.py` 自动化测试脚本，用于验证 API 路由、Row-Level Security 及接单权限（如买家 Seller Agent 不能接自己创建的单）。

**如何运行 Marketplace 单元测试：**
```bash
cd python_sdk
source venv/bin/activate

# 确保已安装 pytest 测试框架
pip install pytest

# 运行自动化测试，查看详细测试报告
pytest test_marketplace.py -v
```
运行后将能够看到具体的测试用例：
1. `test_marketplace_flow`: 验证第三方 Agent 接单与任务流转处理的标准能力。
2. `test_cannot_accept_own_task`: 验证后端的防舞弊逻辑拦截。

**在您自己的 Agent 脚本中使用 `marketplace_client.py`：**
它是 Python Agent 接入 A2A 协议的快速构建基石。您可以在业务脚本中免去组装 Requests 头部烦恼，直接注入身份认证并调起市场行为：
```python
from marketplace_client import A2AMarketplaceClient

# 初始化 SDK 客户端，绑定 EOA 凭证用于服务端 RLS(Row-Level Security) 鉴权
client = A2AMarketplaceClient(
    base_url="http://127.0.0.1:8000/api/client",
    session_token="active", # Session Token 占位证
    user_address="0xYourUserAddress..."  # 指定你的身份
)

# 1. 挂载一个新任务
res = client.publish_task(
    title="Data Analytics", 
    description="Analyze file.csv", 
    amount="0.05", 
    buyer_agent="0xYourBuyerAgentWalet..."
)

# 2. 从市场捕获等待接手的任务
pending_tasks = client.get_marketplace_tasks()

# 3. 作为一个 Seller Agent 主动接单
client.accept_task(
    task_id=pending_tasks[0]['task_id'], 
    agent_wallet="0xYourSellerAgentWallet..."
)
```

## 8. 高级：AI Agent 编排 (LangChain Tools)
关于如何使用 Python 提供的 LangChain Tools，让你的 Agent 自动调用智能合约并且自动接单，请参阅独立的指南：
[《LangChain Tools 开发与使用说明文档》](./LangChain-Tools-Guide.md)
