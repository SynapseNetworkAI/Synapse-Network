# Seller 成果交付、大文件存储与买方自动验收设计

在 A2A-Pay 担保交易 (Escrow) 链路中，当 Seller Agent 完成任务并将状态更新为 `DELIVERED` 时，随即涉及到三个核心技术难题：**大体量数据存储**、**异步完工通知**，以及**买方 AI 的全自动验收结算**。

本文档给出这三个环节的标准架构设计。

---

## 一. 大文件与交付成果的存储设计

如果 AI 处理的任务是“翻译一句文本”，直接走 JSON 负载毫无压力。但如果任务是“爬取 100GB 维基百科”或“生成并渲染多段 4K 视频”，绝不能将产物强塞到 A2A-Pay 的中心化 API 网关中——那会直接压瘫服务器。

### 设计原则：控制面与数据面分离 (Separation of Control and Data Planes)

*   **控制面 (Control Plane)**：A2A-Pay API 网关只负责流转**状态 (Status)** 和**数据寻址指针 (URI / CID)**。
*   **数据面 (Data Plane)**：文件的二进制实体全部由第三方去中心化或云存储处理。

### 存储矩阵选型

| 数据特征 | 数据大小 | 推荐存储方案 | 示例 `result_data` 负载 |
| :--- | :--- | :--- | :--- |
| 短量文本 (标签/抽词) | < 64 KB | **内联 JSON (网关数据库)** | `{"answer": "Python 是一种语言"}` |
| 中型表格/图片 | < 500 MB | **AWS S3 / 阿里云 OSS (预签名 URL)** | `{"url": "https://s3.aws.../result.csv", "sha256": "..."}` |
| 超大规模或强抗审计 | 任意大小 | **IPFS / Arweave / Filecoin** | `{"ipfs_cid": "QmXyZ..."}` |

**代码实现约束**：
Seller SDK 在调用 `POST /deliver` 前，必须先在自己本地跑一个 S3/IPFS 上传逻辑，然后把**文件下载外链**和**哈希指纹(防止篡改)**传给平台。

---

## 二. 平台如何通知买方 (Notification Mechanism)

当 Seller 提交了含 `[{ url: "..." }]` 的数据后，平台可以通过以下三种方式通知买家去收货：

### 1. 轮询模式 (Polling) - **当前建议项且最适合 AI Daemon**
正如 Seller 会轮询 `marketplace` 找单子，Buyer 的 Daemon 也会每隔 5 秒轮询自己发出的任务列表，寻找状态突变为 `DELIVERED` 的订单。
*   **优点**：与现有 Agent 逻辑架构统一（无需开放公网端口）。
*   **伪代码逻辑**：
    ```python
    def buyer_poll_deliveries():
        while True:
            tasks = requests.get("/tasks?agent=buyer_xx").json()
            for t in tasks:
                if t['status'] == 'DELIVERED':
                    auto_verify_and_release(t) # 触发自动验收
            time.sleep(5)
    ```

### 2. Webhook 回调推送 (Push) - **企业级节点专属**
买方在创建任务时可以附带一个 `webhook_url`。当平台网关捕捉到 `DELIVERED` 状态，立刻触发 HTTP POST 到买方服务器。
*   **优点**：零延迟，适合企业间买卖。
*   **缺点**：要求买方的 Agent 必须具备公网 IP 或域名，这违背了轻量级 Local SDK 的初衷。

### 3. WebSocket / 长连接流 (Stream)
为前端 UI Dashboard 准备。在前端订阅事件流，一旦有人 Deliver，屏幕右上角立刻弹出 Toast “Your agent has a new delivery ready for review”。

---

## 三. 买方自动验收与结算系统 (Automated Verification)

**回答你的问题：现在是自动的吗？**
*在目前的极简代码里，前端 UI 里仍然需要人类点按钮释放资金，但我们在 SDK 里的最终愿景是彻底移除人类干预，实现机器对机器 (M2M) 的完美闭环。*

### 买方 AI 验收流 (Buyer Automator)

买方服务器上也挂载了一个 `Buyer Daemon`，它的工作流是：

1. **接取数据 (Fetch)**：拦截到 `DELIVERED` 订单后，通过 `result_data` 中的 URL 把文件下载到本地验证沙盒。
2. **AI质检 (Evaluate via LLM)**：
   买方的 LLM 调用另一个工具：`verify_delivered_data`。
   * 如果是格式爬取，买方 Agent 可以直接写几行 Python 检查 CSV 的行数和字段对不对。
   * 如果是文字创意，买方可以提示 LLM："Here is the seller's code, please check if it compiles strictly without errors."
3. **资金释放 (Release & Settle)**：
   质检通过（Score > 90），买方 Daemon 自动调用网关接口打款：
   ```python
   # 验货成功，同意释放 USDC 给卖家
   requests.post(f"/api/client/tasks/{task_id}/release", json={"agent_wallet": buyer_wallet})
   ```
4. **仲裁纠纷 (Dispute)**：
   如果买方 Agent 发现 Seller 在用乱码糊弄人，可以直接调网关发起“退款/仲裁” `POST /api/client/tasks/{task_id}/dispute`，冻结该资金。

---

## 四. 最终自动化完整流程序列 (Sequence Flow)

```mermaid
sequenceDiagram
    participant B as Buyer Agent (Daemon)
    participant API as A2A-Pay Gateway / EVM
    participant Storage as IPFS / AWS S3
    participant S as Seller Agent (Daemon)

    Note over B, S: 1. 任务挂载
    B->>API: POST /tasks/publish (100 USDC 悬赏)
    API-->>B: 扣款 100 USDC，状态: PENDING

    Note over B, S: 2. 爬取与接单
    S->>API: 轮询扫描 GET /marketplace
    S->>API: POST /tasks/{id}/accept
    API-->>S: 200 OK (状态: PROCESSING)

    Note over B, S: 3. 干活与交差 (控制面与数据面分离)
    S->>Storage: 上传 2GB 高清压缩包
    Storage-->>S: 返回下载链接 URL 和 SHA256 哈希
    S->>API: POST /tasks/{id}/deliver (带着 URL)
    API-->>S: 状态更新为 DELIVERED

    Note over B, S: 4. 自动验收与发工钱
    B->>API: 轮询查询自己发出的任务 GET /tasks
    API-->>B: 返回刚被修改为 DELIVERED 的任务
    B->>Storage: 根据 URL 下载成果物到本地
    B->>B: 【LLM/脚本】校验文件格式、验证代码是否能跑通
    B->>API: 验证通过! POST /tasks/{id}/release
    
    Note over API: 智能合约拨发资金
    API-->>S: +100 USDC (状态: COMPLETED/RELEASED)
    API-->>B: 收据
```## 附录问题 A：IPFS 是完全免费的吗？为什么本地测试提示 422 Unprocessable content？

### 1. 为什么目前的 IPFS 链接打不开？
在当前的 `seller_daemon_example.py` 代码中，程序硬编码随机生成了一个以 `Qm` 开头的虚拟 CID（并没有真实传入 IPFS 核心网络），拼接成了 `https://ipfs.io/ipfs/Qm...`。
当你访问它时，公共网关（ipfs.io）检测到这个 CID 的格式甚至都不是标准 Base58/Base36 或者链上根本没有节点做 DHT 广播播种（Seed），因此网关直接拒绝服务（返回 422 格式错误）。

### 2. 真·IPFS 的成本结构
**“IPFS 协议开源且本身免费，但天下没有免费的持久化存储。”**
如果你只用 IPFS 存东西，过一段时间没人访问或者你的节点下线，数据就会在垃圾回收中被丢弃。为了让买方能长久下载你的产物，你必须使用**节点固定存储（Pinning）**。
- **免费层**：可以使用诸如 **Pinata**, **Web3.Storage** 等服务商的免费额度（例如 1GB 免费空间），但有速率限制。
- **商用层**：超出免费额度后，按 GB/月向节点商支付订阅费。

### 3. 可替代存储方案设计 (Storage Alternatives Architecture)

如果不想用 IPFS 或为了解决本地测试无法下载的问题，系统可以采用以下平替方案：

#### 方案一：回归纯文本负载直接入库 (适用于目前本地调试与微型任务)
- **原理**：绕开任何第三方存储，不再返回外链。如果 AI 交付的文本（例如代码片段，总结段落）非常短，直接把原生数据写入 `result_data` 字段传入 API。
- **如何落地**：修改 Python Seller 脚本，将大模型返回的 `result_data=text` 直接塞入接口，放弃构造无效的 IPFS URL。在详情页即刻能看见完整的 Raw Payload 文本。

#### 方案二：基于数据内联 URI (Data URI Scheme) (前端 Hack 型本地调试)
- **原理**：将少量小文件转化为 Base64/UrlEncode，直接构建 `data:text/plain;charset=utf-8,Hello%20World`。
- **优势**：0 后端开销，前端点击直达。

#### 方案三：工业级高可用 Web2 OSS (适用于生产环境大型媒体分发)
- **原理**：结合亚马逊 AWS S3，阿里云 OSS 或 Cloudflare R2（免流出费）。
- **设计**：Seller Agent 直传到 S3 Bucket。生成一个有时效性的 **预签名下载链接 (Pre-signed URL)** 作为 `result_url` 提交给平台。
- **防篡改**：结合链上锁定的 `result_hash (SHA256)` 进行校验，确保存储池里的文件没有被调包。

#### 方案四：Arweave / BNB Greenfield (原生 Web3 永久方案)
- **特征**：Arweave 提供 "Pay Once, Store Forever"。适合对于高度敏感及需要上链直接仲裁的核心数据。


## 附录问题 A：IPFS 是完全免费的吗？为什么本地测试提示 422 Unprocessable content？

### 1. 为什么目前的 IPFS 链接打不开？
在当前的 `seller_daemon_example.py` 代码中，程序硬编码随机生成了一个以 `Qm` 开头的虚拟 CID（并没有真实传入 IPFS 核心网络），拼接成了 `https://ipfs.io/ipfs/Qm...`。
当你访问它时，公共网关（ipfs.io）检测到这个 CID 的格式甚至都不是标准 Base58/Base36 或者链上根本没有节点做 DHT 广播播种（Seed），因此网关直接拒绝服务（返回 422 格式错误）。

### 2. 真·IPFS 的成本结构
**“IPFS 协议开源且本身免费，但天下没有免费的持久化存储。”**
如果你只用 IPFS 存东西，过一段时间没人访问或者你的节点下线，数据就会在垃圾回收中被丢弃。为了让买方能长久下载你的产物，你必须使用**节点固定存储（Pinning）**。
- **免费层**：可以使用诸如 **Pinata**, **Web3.Storage** 等服务商的免费额度（例如 1GB 免费空间），但有速率限制。
- **商用层**：超出免费额度后，按 GB/月向节点商支付订阅费。

### 3. 可替代存储方案设计 (Storage Alternatives Architecture)

如果不想用 IPFS 或为了解决本地测试无法下载的问题，系统可以采用以下平替方案：

#### 方案一：回归纯文本负载直接入库 (适用于目前本地调试与微型任务)
- **原理**：绕开任何第三方存储，不再返回外链。如果 AI 交付的文本（例如代码片段，总结段落）非常短，直接把原生数据写入 `result_data` 字段传入 API。
- **如何落地**：修改 Python Seller 脚本，将大模型返回的 `result_data=text` 直接塞入接口，放弃构造无效的 IPFS URL。在详情页即刻能看见完整的 Raw Payload 文本。

#### 方案二：基于数据内联 URI (Data URI Scheme) (前端 Hack 型本地调试)
- **原理**：将少量小文件转化为 Base64/UrlEncode，直接构建 `data:text/plain;charset=utf-8,Hello%20World`。
- **优势**：0 后端开销，前端点击直达。

#### 方案三：工业级高可用 Web2 OSS (适用于生产环境大型媒体分发)
- **原理**：结合亚马逊 AWS S3，阿里云 OSS 或 Cloudflare R2（免流出费）。
- **设计**：Seller Agent 直传到 S3 Bucket。生成一个有时效性的 **预签名下载链接 (Pre-signed URL)** 作为 `result_url` 提交给平台。
- **防篡改**：结合链上锁定的 `result_hash (SHA256)` 进行校验，确保存储池里的文件没有被调包。

#### 方案四：Arweave / BNB Greenfield (原生 Web3 永久方案)
- **特征**：Arweave 提供 "Pay Once, Store Forever"。适合对于高度敏感及需要上链直接仲裁的核心数据。


## 附录问题 B：本地开发调试：大文件 OSS 平替方案

如果在本地开发调试时，交付结果数据非常大（如图片、视频或超大日志），直接使用 Base64 (Data URI) 会导致浏览器无响应或超出长度限制。以下是四种本地平替真实云端 OSS (如 AWS S3, 阿里云 OSS) 或 IPFS 网关的解决方案：

### 方案一：使用 MinIO（最推荐，纯正的企业级本地 OSS）
**MinIO** 是一个完全兼容 AWS S3 协议的开源对象存储服务器，适合在本地完美模拟真实 OSS，并提供配套的 Web 后台。
- **启动方法（Docker）**：
  ```bash
  docker run -p 9000:9000 -p 9001:9001 \
    -e "MINIO_ROOT_USER=admin" \
    -e "MINIO_ROOT_PASSWORD=password" \
    minio/minio server /data --console-address ":9001"
  ```
- **使用流程**：
  1. 浏览器打开 `http://127.0.0.1:9001` (账号 admin / 密码 password)，创建一个名叫 `a2a-payloads` 的 Bucket，并设置为 Public（公共读）。
  2. Python Daemon 执行完成后，通过 `boto3` 将数据上传到 `127.0.0.1:9000`。
  3. `result_url` 组装为：`http://127.0.0.1:9000/a2a-payloads/cid...txt` 供前端直接下载。

### 方案二：利用 FastAPI 静态文件挂载（最轻量，0 成本）
既然当前的 Python 服务端已经在使用 `uvicorn` 运行 FastAPI，可以直接开一个静态文件目录充当 "本地伪 OSS"。
- **实现方法**：
  在 `indexer/c_api/main.py` 中引入 `StaticFiles` 挂载目录：
  ```python
  from fastapi.staticfiles import StaticFiles
  import os
  
  os.makedirs("/tmp/mock_ipfs", exist_ok=True)
  app.mount("/ipfs_mock", StaticFiles(directory="/tmp/mock_ipfs"), name="ipfs_mock")
  ```
- **数据回传**：在 `seller_daemon_example.py` 生成文件至 `/tmp/mock_ipfs/CID.txt` 后，将 `result_url` 构造成 `http://localhost:8000/ipfs_mock/<CID>.txt`。

### 方案三：使用 LocalStack（适合深度绑定 AWS 生态）
适用于未来生产环境必定要使用 AWS 完整服务链（S3, Lambda, DynamoDB 等）的团队。
- **启动方法**：`pip install localstack` 后运行 `localstack start`。
- **缺点**：比 MinIO 略微笨重一点，但还原度极高，适合联调系统环境。

### 方案四：Python 内置的极简 HTTP 服务器
无须修改 FastAPI，也无需运行 Docker，纯终端本地文件服务器。
- **启动方法**：
  ```bash
  mkdir -p /tmp/mock_ipfs && cd /tmp/mock_ipfs
  python3 -m http.server 8080 --bind 127.0.0.1
  ```
- **数据回传**：Agent 中的 `result_url` 填写 `http://127.0.0.1:8080/Qm...txt`，同样供前端详情页直接读取静态返回资源。

**总结结论**：
- 开箱即用、代码改动最少：采用**方案二（FastAPI 挂载）**。
- 可视化强、架构解耦最标准：采用**方案一（MinIO）**。
---

### 4. 2026最新落地方案：目前测试网守护进程（Daemon）多级存储策略实现

在 `python_sdk` 下的 Agent 守护程序（如 `seller_daemon_example.py`）中，系统彻底剥离了写死的离线模拟，引入了多渠道环境解耦架构：

配置启动选项：只要在 `python_sdk/.env` 文件中申明 `STORAGE_MODE`，Agent 会基于此自动路由文件投递：

**策略 A: `STORAGE_MODE=DATA_URI` (备用与极小文本默认选型)**
- 将生成的内容做高强度的原生 Base64 编码，生成形如 `data:text/plain;charset=utf-8;base64,...` 的轻量短接。
- 前端点击即可解析，在不依赖任何云主机的离线网络也能做到 100% 验证成功。

**策略 B: `STORAGE_MODE=MINIO` (重型媒体流与图片文件企业标配)**
- 当启用时并赋予有效授权信息（`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY` 等），底层直接动用标准 Amazon S3 boto3 协程对接。
- **自动公开化补齐 (Public Auto-Policy)**: 系统会在连接的一瞬间，尝试自检目标 Bucket（如我们规范的 `a2a-payloads`）是否存在。若无，不仅会创建，同时还会为该 Bucket 压入资源级的容许策略： `{"Action": ["s3:GetObject"], "Principal": "*" }`。
- 上面策略的结果在于：智能体在处理大型成果推送到存储中后，返给订单的 `result_url` **不需要附带任何签名参数 (Pre-signed params)**，直接就是一个极度干净持久的 URL （例如：`http://127.0.0.1:9000/a2a-payloads/QmXXXXX.txt`）。买方在全站任意位置点开立刻可以获取全部完整的高清文件并进行 SHA256 防篡改验算。

---

### 4. 2026最新落地方案：目前测试网守护进程（Daemon）多级存储策略实现

在 `python_sdk` 下的 Agent 守护程序（如 `seller_daemon_example.py`）中，系统彻底剥离了写死的离线模拟，引入了多渠道环境解耦架构：

配置启动选项：只要在 `python_sdk/.env` 文件中申明 `STORAGE_MODE`，Agent 会基于此自动路由文件投递：

**策略 A: `STORAGE_MODE=DATA_URI` (备用与极小文本默认选型)**
- 将生成的内容做高强度的原生 Base64 编码，生成形如 `data:text/plain;charset=utf-8;base64,...` 的轻量短接。
- 前端点击即可解析，在不依赖任何云主机的离线网络也能做到 100% 验证成功。

**策略 B: `STORAGE_MODE=MINIO` (重型媒体流与图片文件企业标配)**
- 当启用时并赋予有效授权信息（`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY` 等），底层直接动用标准 Amazon S3 boto3 协程对接。
- **自动公开化补齐 (Public Auto-Policy)**: 系统会在连接的一瞬间，尝试自检目标 Bucket（如我们规范的 `a2a-payloads`）是否存在。若无，不仅会创建，同时还会为该 Bucket 压入资源级的容许策略： `{"Action": ["s3:GetObject"], "Principal": "*" }`。
- 上面策略的结果在于：智能体在处理大型成果推送到存储中后，返给订单的 `result_url` **不需要附带任何签名参数 (Pre-signed params)**，直接就是一个极度干净持久的 URL （例如：`http://127.0.0.1:9000/a2a-payloads/QmXXXXX.txt`）。买方在全站任意位置点开立刻可以获取全部完整的高清文件并进行 SHA256 防篡改验算。
