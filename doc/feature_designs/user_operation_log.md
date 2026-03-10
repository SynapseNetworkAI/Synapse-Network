# 用户操作日志系统设计文档

## 1. 需求背景
目前在 `dashboard/router` 页面以及整个系统中，用户进行的各种交易和操作（如注册服务、更新服务、提现、充值等）没有统一的日志记录。为了更好的系统追踪、安全审计和问题排查，需要增加用户操作日志功能。

## 2. 日志数据结构
为了详细记录“哪个用户操作了什么”，日志需要包含以下核心字段：

| 字段名称 | 描述 | 类型 | 示例 |
|---------|------|------|------|
| `id` | 日志唯一标识 | String (UUID) | `123e4567-e89b-12d3...` |
| `timestamp` | 操作发生的时间戳 | String (ISO 8601) | `2024-03-10T15:30:00Z` |
| `user_address` | 提交该操作的用户钱包地址 | String | `0x123...abc` |
| `action_type` | 操作类型 | String | `REGISTER_SERVICE`, `UPDATE_SERVICE`, `WITHDRAW` |
| `details` | 操作的具体详情内容(JSON格式) | Object | `{"serviceId": "1", "amount": "100"}` |
| `status` | 操作的最终状态 | Enum | `SUCCESS`, `FAILED`, `PENDING` |
| `tx_hash` | 如果是链上操作，则关联交易哈希 | String (可选) | `0xabc...def` |
| `error_message` | 失败时的错误信息 | String (可选) | `User denied transaction signature` |

## 3. 架构设计与存储方案

根据当前的系统架构（Next.js Frontend + 合约），可以采用以下方案之一：

### 方案 A：前端本地存储 (Local Storage / IndexedDB) - 轻量级且适合单机
* **优点**：无需复杂的后端支持，开发最快。
* **缺点**：如果用户换浏览器，日志会丢失，无法进行全局审计。

### 方案 B：Next.js API Routes + 服务端文件系统 (JSONL / SQLite) - 推荐
利用 Next.js 自带的 API 功能构建一个服务端记录系统：
1. **API 接口**：增加 `/api/logs` 作为统一接收并存储日志的接口。
2. **存储介质**：可以使用本地 JSONL 文件 (如 `audit_log.jsonl`，与现有的 `python_sdk` 对齐)，或者使用轻型的 SQLite 数据库（如果数据量增长）。
3. **前端调用**：封装一个全局 `useActionLogger` Hook 或 `loggerService` 方法，自动捕获用户的行为、状态，并发出请求。

### 方案 C：独立后端/索引服务（Graph/SubQuery）
对于以太坊或区块链项目来说，可以通过事件监听器来统一生成日志。
* **优点**：完全不可篡改，数据可靠。
* **缺点**：仅限链上操作，且实时性和失败交互等无法全面监控。

## 4. 实施阶段计划 (对应方案 B)

1. **后端 API 实现**：
   - 在 `frontend/src/app/api/logs/route.ts` 定义 POST 路由。
   - 编写服务方法，将请求的数据追加至磁盘上的 `.logs/user_actions.jsonl`。
2. **前端日志收集器实现**：
   - 创建 `frontend/src/utils/logger.ts` 提供 `logUserAction` 方法。
3. **页面埋点改造 (`dashboard/router` 等)**：
   - 在关键按钮或交互（例如 `registerService`, `updateService` 交易执行完成后或者出错时）调用 `logger`。
4. **日志查看界面 (可选)**：
   - 如果需要，提供一个类似 `/admin/logs` 或者是 `/dashboard/logs` 的页面来调用 GET 接口并展示数据表格式的日志结果。

## 5. 生产级架构设计方案 (可插拔存储)

为了实现“将来可以无缝过渡到生产级别且存储介质可自由切换”的目标，系统的核心架构基于 **依赖倒置原则 (Dependency Inversion Principle)** 和 **适配器模式 (Adapter Pattern)** 进行设计。

业务代码（如 Next.js API 路由）不直接操作文件 (JSONL) 或数据库，而是只面向一个**抽象的日志存储接口 (Interface)** 编程。具体的存储实现通过**环境变量**在运行时动态注入。

### 5.1 核心架构思想：端口与适配器模式

1. **核心接口定义 (The Contract)**：定义数据标准 `UserOperationLog` 和存储契约 `ILogStorageAdapter`。
2. **存储适配器 (Adapters)**：
   - **JsonlAdapter**：本地文件追加，适合 MVP 阶段，与现有的 Python SDK 脚本对齐，快速落地。
   - **PostgresAdapter** (未来)：关系型数据库，具备强事务支持和关联查询能力。适合正式生产阶段。
   - **Kafka / Elasticsearch Adapter** (未来)：应对海量并发的分布式存储引擎。
3. **日志工厂 (Logger Factory)**：利用工厂和单例模式，根据环境变量 `LOG_STORAGE_DRIVER` 动态注入对应的 Adapter，实现无缝切换。

### 5.2 演进路线图

* **阶段 1：本地开发与灰度 MVP（当前阶段）**
  * 配置环境变量 `LOG_STORAGE_DRIVER=jsonl`。系统在服务端将日志写入 `audit_log.jsonl`，成本最低。
* **阶段 2：正式生产与 Dashboard 后台（爆发期）**
  * 更改环境变量 `LOG_STORAGE_DRIVER=postgres` 并配置 `DATABASE_URL`。业务代码完全无需修改，通过 SQL 或 Admin 面板分析日志。
* **阶段 3：海量并发与分布式系统（成熟期）**
  * 引入 Redis/Kafka 适配器，将日志先打入队列，再由后台微服务落盘至 Elasticsearch，保证主应用不受 I/O 阻塞。
