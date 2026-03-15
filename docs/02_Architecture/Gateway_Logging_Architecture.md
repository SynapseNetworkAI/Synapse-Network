# API网关请求与计费日志架构设计

本文档记录了平台网关在处理Buyer端调用时，关于请求记录记录（日志记录）、对账处理（基于requestId）以及日志存储架构的演进设计。

## 一、 核心概念：全局唯一 Request ID (Trace ID)

在任何带有计费属性的API网关中，日志不仅是排错工具，更是核心资产（资金扣除的凭证）。因此，**必须在请求发生的入口处生成一个全局唯一的 `requestId`**。

### Request ID 的生命周期与价值：
1. **统一追踪**：客户端调用 SDK 时由 SDK 生成 `requestId`（如 `X-Request-Id`）传入网关。若未传，网关接收到请求的第一时间必须自动生成一个 UUID。
2. **防重放与幂等性**：遇到网络超时等问题客户端重试时，携带相同的 `requestId`，网关可以借此防止重复扣费。
3. **三方对账与异常举证**：网关在转发请求给 Provider 时，也需要将该 `requestId` 透传给下游。当出现资金纠纷时的对账链条为：
   `Buyer 拿着 requestId -> 平台校验自身日志 -> 平台拿着 requestId 找 Provider 核对真实消耗`。

---

## 二、 日志存储架构：策略模式与依赖注入

为了实现“起步轻量、未来能扛且随时可切换”的要求，在代码层面必须使用**策略模式（Strategy Pattern）与依赖注入（Dependency Injection）**来解耦网关核心逻辑与日志存储逻辑。

### 代码落地的核心抽象（Python 示例）
将日志记录抽象成一个接口，在配置中决定加载哪种实现，实现热插拔：

```python
from abc import ABC, abstractmethod
from typing import Dict, Any

class AbstractUsageLogger(ABC):
    @abstractmethod
    async def log_request(self, request_id: str, payload: Dict[str, Any]):
        pass

# 1. 本地文件/JSON 实现 (用于开发和早期测试)
class FileUsageLogger(AbstractUsageLogger):
    async def log_request(self, request_id: str, payload: Dict[str, Any]):
        # 追加写 usage_log.json
        pass

# 2. 关系型数据库+异步持久化 (过渡期)
class SqlAsyncUsageLogger(AbstractUsageLogger):
    async def log_request(self, request_id: str, payload: Dict[str, Any]):
        # 利用 FastAPI BackgroundTasks 或 Celery 写入 PostgreSQL/MySQL
        pass

# 3. 消息队列 (生产规模)
class KafkaUsageLogger(AbstractUsageLogger):
    async def log_request(self, request_id: str, payload: Dict[str, Any]):
        # 网关只负责毫秒级将日志 push 到 Kafka 主题
        pass

# 工厂模式加载
def get_logger() -> AbstractUsageLogger:
    strategy = config.get("LOG_STRATEGY", "file")
    if strategy == "kafka": return KafkaUsageLogger()
    elif strategy == "sql": return SqlAsyncUsageLogger()
    return FileUsageLogger()
```

---

## 三、 架构演进路线图

根据业务规模的增长，日志架构分为以下三大阶段同步演进：

### 第 1 阶段：轻量级本地实现（当前/早期）
* **架构**：业务网关 (FastAPI) + 本地 JSON / 轻型的 SQLite
* **方案**：目前硬编码写入 `usage_log.json`，验证流转逻辑即可。此时对账基于脚本或者手动解析JSON进行。

### 第 2 阶段：过渡/中型方案（单体/服务化演进）
* **适合阶段**：日调用量 10万 ~ 100万，无需极高的大数据分析性能。
* **架构**：业务网关 (FastAPI) + PostgreSQL / MySQL。
* **写入策略**：**绝对避免同步阻塞写入业务库**。使用 FastAPI 自带的 `BackgroundTasks`，将计费日志 `INSERT` 操作变更为异步操作执行。
* **对账方式**：编写 SQL 视图和离线脚本，通过 `requestId` 关联扣费流水表和请求调用表进行对账。

### 第 3 阶段：生产级别高并发微服务架构
* **适合阶段**：日调用量百万、千万甚至过亿，对账复杂度高，需要风控和大数据追踪分析。
* **网关层**：负责鉴权、路由、以及对内存/Redis计费账户进行**扣费预占**。网关处理完响应后，只需要把完整的 Request/Response/扣费明细 打包成 JSON 或 Protobuf 发入消息列队一层（几毫秒）。
* **缓冲传递层 (Kafka / Pulsar)**：即使后端处理瘫痪，计费凭证依然安全留存在消息队列内不丢失。
* **消费者服务流 (Consumers / ETL)**：
  1. **资金落库流**：Consumer A 消费 Kafka 队列，将明确成功的扣单最终确认，并写入核心关系型数据库 (PostgreSQL) 形成真实的不可篡改的账单流水。
  2. **日志检索与审计流**：Consumer B 将同一份日志消费后批量存入 Elasticsearch (ES) / ClickHouse。为运营控制台与前端审计日志提供强悍的“按 requestId 或钱包地址进行全文检索”能力。
  3. **数据冷备流**：定期利用清洗程序或 Flink 将队列内久远的数据转储到 AWS S3 / 阿里云 OSS 作为廉价数据归档，并满足合规审查。

## 四、 立即执行项建议
1. **注入请求级ID**：在入口拦截器中间件 (Middleware) 中自动检查并注入：
   `request_id = request.headers.get("X-Request-Id") or str(uuid.uuid4())`
2. **抽象日志接口**：按照上述**策略模式**抽出 `BaseLogger` 接口，替换当前 `seller_api` 下的 `usage_logs.append(...)`。
3. **改造为异步执行**：不要将计费记录动作阻塞在核心生成路由中，把它包装成 FastAPI BackgroundTask。