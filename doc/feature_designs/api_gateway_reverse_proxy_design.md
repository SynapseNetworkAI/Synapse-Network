# 生产级 API 网关鉴权与反向代理设计文档

## 1. 架构定位与目标
在 AgentPay 平台中，Seller API（网关节点）扮演了流量入口与账单结算的核心角色。网关不仅要承担客户端 Agent 购买服务的鉴权和扣费，还要负责将请求安全、透明、高效地路由到真正的底层微服务（如 `provider_service`）。

### 核心目标
*   **高可用 (High Availability)**：网关作为流量咽喉，必须具备容灾、重试、熔断能力。
*   **高性能 (High Performance)**：鉴权与扣费需要极低延迟，避免成为业务瓶颈。反向代理层必须采用异步 IO 模型。
*   **限流与账期保护 (Rate Limiting & Billing)**：防止 DDoS 爆刷，同时避免买家超出每日限额（Daily Limit）或智能合约可扣费余额。
*   **透明转发与链路追踪 (Tracing & Observability)**：保证 `request_id` 在微服务间透传一致，为对账引擎（Reconciliation）提供最终凭证。

---

## 2. 整体架构流程设计

当买方 Agent 向平台发起 API 调用时，网关的完整处理链路分为四个截段：**拦截校验 -> 预扣费与限流 -> 黑盒转发 -> 异步对账**。

```text
                                +-----------------------------------+
 [ Buyer Agent ]                |         API Gateway (Seller API)  |
      │                         |                                   |
      │ 1) POST /api/v2/generate|  +-----------+     +-----------+  |
      ├─────────────────────────┼─►| 1. 访问控制 |────►| 2. 计费限流 |  |
      │                         |  | (Auth)    |     | (Billing) |  |
      │                         |  +-----------+     +-----------+  |
      │                         |         │                │        |
      │                         |         ▼                ▼        |
      │                         |  +-------------------------------+  |
      │                         |  | 3. 分布式限流与反向代理       |  |
      │                         |  |    (Reverse Proxy & RateLimit)|  |
      │ 4) Returns Gateway Resp |  +-------------------------------+  |
      ◄─────────────────────────┼───────│------------------▲--------+
                                        │ 2) httpx.post    │ 3) raw JSON
                                        ▼                  │
                                +-----------------------------------+
                                |    Provider Service (8100 端口)   |
                                |       (/api/v1/quotes/famous)     |
                                +-----------------------------------+
```

---

## 3. 核心功能模块设计

### 3.1 鉴权（Authentication）层
**设计原则**：基于密码学签名的去中心化验证，剥离重度数据库查询。
*   **凭证校验**：通过提取请求头 `X-Agent-Credential` 的临时会话 Token。
*   **签名机制**：买方在请求时利用私钥生成 ECDSA 签名或使用平台下发的短期 API Key。
*   **状态本地化**：为了提速，活跃的 Credential 缓存在内存（或者 Redis）中，鉴权阶段无需调用智能合约/RPC 节点，只做密钥匹配和时效性校验。

### 3.2 计费与限流（Billing & Rate Limiting）层
**设计原则**：漏桶/令牌桶限流与预扣费模型结合，避免“超卖”套利。
*   **分布式限流算法**：
    *   针对单接口的 QPS 限制（防攻击保护服务提供商）：基于 Redis 的令牌桶（Token Bucket）。
    *   针对平台每日配额（Daily Limit Usdc）：采用 Redis INCR 原子操作累加请求计费金额，对比上限配额。
*   **预扣费（Pre-deduction）机制**：
    1.  校验买方链上锁定的 Vault 余额 `(Deposit - Used > API_Price)`。
    2.  如果余额足够，直接在 Redis 或本地内存 Ledger 中原子级自增单次调用的单价（UnitPrice）。
    3.  若 Provider 请求失败，则回滚（Rollback）该笔费用的扣除。
*   **容灾隔离**：即使底层的区块链节点（RPC）不可用，只要本地已拉取过余额缓存，该节点的记账能力就不受影响。

### 3.3 反向代理与黑盒转发（Reverse Proxy）层
**设计原则**：非阻塞、连接池化、故障熔断。
*   **异步 IO (httpx)**：当前的架构在 FastAPI 中采用 `httpx.AsyncClient` 来转发流量，避免同步 `requests` 堵塞主事件循环。
*   **连接池优化 (Connection Pooling)**：在生产级中，应保持 `httpx.AsyncClient` 的单例化 (Singleton)，以复用 TCP 连接和 TLS 握手，极大降低调用 Provider 的延迟。
*   **熔断与重试 (Circuit Breaker)**：增加如 `Tenacity` 的失败重试策略库当 Provider 出现短时 502/503 时，可安全重试。连续报错阈值后触发熔断，直接给终端返回 `PROVIDER_UNAVAILABLE` 防止全链路瘫痪。
*   **透明溯源**：在 Proxy 转发时，将网关生成的 `X-Request-Id` 以 Header 的形式注入给 Provider，便于后续 ELK/Loguru 的链路排错。

### 3.4 异步对账（Asynchronous Reconciliation）层
**设计原则**：保证 Provider 服务真实交付后再进行最终账单固化。
*   请求通过 Provider 处理成功并返回内容后。网关将结果包装成统一规范如 `{ status: "success", "billing": {...}, "data": {...} }` 返回给调用方。
*   利用 FastAPI 的 `BackgroundTasks` 或 MQ，把此次成功交易记录写入异步 Kafka 或 Audit log 中（参考第一阶段的 File Tracing 方案）。

---

## 4. 生产级进阶扩展 (Phase 2 & Phase 3)

如果后续业务量暴涨，对于单机网关可能面临瓶颈，必须引入以下设计：

1.  **全局限流网关剥离**：
    *   将本架构里的“反向代理层”交由专业的云原生网关系统如 **Apache APISIX** 或 **Envoy** 接管。
    *   鉴权模块以插件/WASM的形式注入网关侧，进行鉴权拦截。
2.  **服务发现与治理能力 (Service Discovery)**：
    *   随着 Provider 变多（如大模型提供商 API、数据服务方 API），硬编码 URL 将无法维护。在网关层集成 Consul 或 Nacos 服务发现中心，由配置中心动态下发路由规则和黑白名单。
3.  **灰度发布**：
    *   在反向代理分发时增加 Hash 指纹的权值判断，让 10% 的 AgentPay Request 转发到新的 Provider Service 测试节点，平滑升级大模型。