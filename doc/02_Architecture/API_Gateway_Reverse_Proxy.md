# 生产级 API 网关鉴权与反向代理设计文档

## 1. 架构定位与目标
在 Synapse Network 平台中，Seller API（网关节点）扮演了流量入口与账单结算的核心角色。网关不仅要承担客户端 Agent 购买服务的鉴权和扣费，还要负责将请求安全、透明、高效地路由到真正的底层微服务（如 `provider_service`）。

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
      │ 1) POST /api/v1/gateway/generate|  +-----------+     +-----------+  |
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

### 3.5 服务健康监控与健康路由（Service Health Monitor）
**设计原则**：发现与转发一致（Discover == Routing），避免“展示可用但实际不可用”的状态错配。

1. **持续探活任务（Background Probe Loop）**
  - 在 Seller API 启动时拉起后台任务：`run_service_health_monitor`。
  - 固定周期扫描 active 服务并探测每个 `invoke.targets[]`。
  - 默认探测间隔：`SERVICE_HEALTH_PROBE_INTERVAL_SEC=15`。

2. **探活地址与判定策略**
  - 探活地址规则：`origin(target.url) + healthCheck.path`。
  - 例：`http://127.0.0.1:8100/api/v1/quotes/famous` + `/health` => `http://127.0.0.1:8100/health`。
  - 成功状态码：`healthCheck.successCodes`。
  - 阈值：`healthyThreshold` / `unhealthyThreshold`。

3. **状态持久化（DB-first）**
  - 每个 service 记录持久化 `serviceHealth`：
  - `overallStatus`、`healthyTargets`、`totalTargets`、`lastCheckedAt`。
  - `targets[url]` 子状态：`status/httpStatus/latencyMs/consecutiveSuccesses/consecutiveFailures/lastHealthyAt/error`。
  - 存储后端与主数据一致：JSON（Dev）或 PostgreSQL（Prod）。
  - 同步写入规范化健康表 `service_target_health`（每个 target 一行），用于可观测与审计查询。
  - 同步写入历史表 `service_target_health_history`（每次探测一行），用于 Seller 健康明细回溯。

4. **Discover 准入门禁**
  - `GET /api/v1/services/discover` 仅返回 `healthyTargets >= 1` 的 active 服务。
  - `status` 字段返回健康状态（`healthy|degraded|unhealthy|unknown`），用于前端实时展示。

5. **Forwarding 健康选路**
  - `POST /api/v1/gateway/generate` 默认仅从健康节点池做加权随机。
  - 若无健康节点，直接返回 `503 SERVICE_UNAVAILABLE`，不盲打故障上游。

6. **存储成本控制（Retention & Cleanup）**
  - 默认历史保留：`3 小时`（`SERVICE_HEALTH_HISTORY_RETENTION_HOURS=3`）。
  - 按配置节奏执行清理（`SERVICE_HEALTH_HISTORY_PRUNE_INTERVAL_SEC`，默认 300 秒），避免每轮探活都全量 prune。
  - 每次清理执行两类删除：
    1. 清理过期历史记录（`checkedAt < now - retention`）
    2. 清理 orphan 记录（`serviceId` 已不存在于 `service_registry`）
  - 当 Seller 删除服务时，服务注册与健康快照/历史会保持同步，相关健康任务数据不会残留。

这套策略对齐了 Google/AWS 的常见生产实践：
1. 健康检查状态缓存 + 周期刷新。
2. 控制面（发现页）与数据面（转发）使用同一健康事实源。
3. 无健康节点时快速失败而非放大延迟尾部风险。

### 3.6 Forwarding Service 分层重构（2026-03）
为降低 `generate` 主路径复杂度并提升可维护性，转发链路在服务层拆分为“编排层 + 能力模块”，外部行为保持不变：

1. `src/services/forwarding_service.py`
  - 仅负责主流程编排：鉴权校验、限流、扣费、上游调用、回滚、审计。
2. `src/services/forwarding_validation.py`
  - 负责输入校验与 invoke 契约校验（`POST + application/json + schema.required`）。
3. `src/services/forwarding_upstream.py`
  - 负责加权选路、请求转发、请求/响应字节限制。
4. `src/services/forwarding_billing.py`
  - 负责费率解析、账本扣费/回滚、usage log 与 buyer receipt 组装。

该拆分遵循高内聚低耦合原则：策略规则与副作用（账本写入/网络 IO）分离，便于单元测试精准覆盖与后续横向扩展（例如替换存储实现、替换路由策略）。

### 3.7 Provider 收益可观测设计（DB-first）

Provider Console 的收益面板采用网关数据库作为主数据源，而不是链上事件回放：

1. 结算真相源
  - `usage_log`：单次调用结算明细（`unit_price/protocol_fee/routing_tax/seller_net/request_id/status`）。
  - `balance_ledger.sellers[owner]`：卖家可提现余额（`sellerReceivable`）。
2. 聚合原则
  - 只聚合 `status=succeeded`。
  - 以 `request_id` 去重，避免重试或重复写日志导致重复统计。
  - 同 request_id 多条时保留最新 `created_at`。
3. 可验证性
  - 汇总接口返回 `duplicateRowsDropped` 与 `idempotencyKey=request_id`，便于审计“是否发生重复日志”。
  - 汇总结果应满足：`sellerReceivable` 与账本余额一致；`sellerNetEarned` 与去重后的明细求和一致。

---

## 4. 生产级进阶扩展 (Phase 2 & Phase 3)

如果后续业务量暴涨，对于单机网关可能面临瓶颈，必须引入以下设计：

1.  **全局限流网关剥离**：
    *   将本架构里的“反向代理层”交由专业的云原生网关系统如 **Apache APISIX** 或 **Envoy** 接管。
    *   鉴权模块以插件/WASM的形式注入网关侧，进行鉴权拦截。
2.  **服务发现与治理能力 (Service Discovery)**：
    *   随着 Provider 变多（如大模型提供商 API、数据服务方 API），硬编码 URL 将无法维护。在网关层集成 Consul 或 Nacos 服务发现中心，由配置中心动态下发路由规则和黑白名单。
3.  **灰度发布**：
    *   在反向代理分发时增加 Hash 指纹的权值判断，让 10% 的 Synapse Network Request 转发到新的 Provider Service 测试节点，平滑升级大模型。

---

## 5. 卖家 (Provider) 接入规范与接口协议设计

为了让整个生态形成“即插即用”的标准市场，让买方 Agent 可以无脑调用网络里所有的服务，我们必须给卖家定下一个严格、统一、且极简的**接口接入契约 (Provider API Contract)**。

### 5.1 整体接入理念：黑盒且极简
*   **卖家零负担接入**：卖家只需提供一个可公网访问的 HTTP 服务即可。**不需要**在代码里集成任何复杂的区块链、USDC 扣费、钱包签名校验逻辑，这些脏活累活**网关全包了**。
*   **关注输入输出即可**：卖家唯一的责任就是，接收网关传过来的标准 JSON 格式输入，执行自己的核心业务（发段子、跑模型检索数据等），最后返回标准 JSON 格式的输出。

### 5.2 统一接口交互协议 (The Universal Protocol)
无论卖家提供的是「天气预报」、「名言警句」、「大模型聊天」还是「区块链数据爬取」，全部遵循这套一致的 HTTP + JSON Schema 标准。

#### 1. 路由与 Method
所有由网关转发给卖家的业务请求，**一律强制使用 `POST` 方法**。因为 AI 场景下买方的查询条件 (Prompt 或 Context) 往往数据量庞大，使用 GET 限制太多。
*   **Method**: `POST`
*   **Content-Type**: `application/json`

#### 2. 请求头 (Headers) 注入规范
网关向卖家转发时，会自动在 Headers 里注入关键的环境信息，供卖家做链路追踪或深度风控：
*   `X-Synapse-Request-Id`: 全网唯一的 UUID（如 `req_8f12cc2a...`），用于对账和日志排障。
*   `X-Synapse-Buyer-Address` (可选): 买方的链上地址。绝大部份卖家无需理会，但若卖家希望针对特定大客户做业务层面的数据隔离，可以取用此字段。

#### 3. 请求体设计 (Request Body)
为了抹平各色各样的外部 API，我们将买方传入的业务参数全部打包在 `payload` 容器里，网关将其原封不动透传。
**卖家收到的 HTTP Request Body (JSON) 范例:**
```json
{
  "request_id": "req_8f12cc2a19...",
  "payload": {
    "text": "想要放弃的时候，请给我一句关于坚持的名人名言",
    "language": "zh"
  },
  "timestamp": 1712400000
}
```

#### 4. 响应体设计 (Response Body)
卖家的返回值必须符合固定包裹范式，不能任意返回 404 HTML 或纯文本。这样网关才能完美解析并抽成标准账单事件给买方。
**正确返回规范 (HTTP Status 200):**
```json
{
  "status": "success",
  "data": {
    "quote": "宝剑锋从磨砺出，梅花香自苦寒来。",
    "author": "佚名"
  }
}
```
**错误返回规范 (业务级别报错情况)：**
即使卖家内部业务失败（比如查不到数据），也建议返回 HTTP `200` 并通过 `status` 标明错误，防止直接抛出 500 被网关作为故障节点降级。
```json
{
  "status": "error",
  "message": "暂无该分类的名言警句"
}
```
*注：一旦由于超时（如超15秒）或服务端彻底崩溃返回 HTTP `5xx`，网关会拦截报错输出 `Provider Unavailable`，并向买方执行全额退款操作。*

### 5.3 Agent 友好型服务自述 (Service Manifest)
怎样让买方代码里的 AI Agent 能够自动发现甚至自动理解参数去调用卖家的服务？
卖家在 Synapse Dashboard 上架服务时，需要补充一份类似 OpenAPI 规范的**元数据注册文件 (Service Manifest)**：

```json
{
  "service_id": "svc_7f8a9b2c1...", 
  "version": "1.0.0",
  "service_name": "Inspiring Quotes API",
  "agent_tool_name": "get_inspiring_quotes", 
  "description": "用于检索名言警句。当用户情绪低落、面临挑战或明确要求提供鼓励性名言时，调用此工作流。",
  "intent": ["名人名言", "quotes", "motivation"],
  "endpoint": "https://seller.ai-domain.com/api/v1/quotes",
  "health_check": "https://seller.ai-domain.com/api/v1/health",
  "pricing": {
    "currency": "USDC",
    "amount": "0.01",
    "type": "per_call"
  },
  "constraints": {
    "max_response_bytes": 2048,
    "timeout_ms": 3000,
    "max_qps": 50
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "text": { 
        "type": "string", 
        "description": "用户的提示词需求",
        "maxLength": 200
      },
      "category": {
        "type": "string",
        "description": "名言的对应分类领域。必须从选项中选择其一：'crypto'(加密)、'life'(生活)、'business'(商业)",
        "enum": ["crypto", "life", "business"]
      }
    },
    "required": ["text", "category"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "quote": { "type": "string", "description": "获得的名言文本" },
      "author": { "type": "string", "description": "名言作者" }
    }
  }
}
```

**为什么这种配置达到了工业级架构标准，并且是“大模型友好的降维打击”？这就叫防御型规范设计：**

0.  **全网唯一标识 (Platform Injected ID)**：`service_id` (如 `svc_7f8a...`) 是卖家将此 Manifest 提交给平台后，由**平台智能合约或中央仓储自动分配下发的全网唯一路由主键**。买家代码 `client.call_service(service_id="...")` 时，网关就是靠它去 O(1) 匹配对应的 `endpoint` 与扣费单价的。它是脱离了复杂 URL 记忆的极简指针。
1.  **AI 工具解析硬标准 (Agent Tool Strictness)**：`service_name` 通常带有空格，**完全不符合**大模型（如 OpenAI/Claude）对 Function calling 名称 `^[a-zA-Z0-9_-]{1,64}$` 的正则约束。我们引入了 `agent_tool_name` 专供大模型底座注册该工具。同时 `description` 采用**触发条件断言**（"当用户情绪低落时调用此工作流..."），而不是纯平铺直叙，这极大提高了大模型自主决定挂载此能力的命中率。
2.  **安全隔离与防“白嫖” (Gateway -> Seller Auth)**：如果卖家的 `endpoint` 是公网地址，任何人都能绕开计费网关直接狂刷卖家的接口。设计上，Gateway 除了分配 Request ID，一定会向卖家下送签名报文（如附加 `X-Synapse-Signature`）。卖家只需校验签名是否来自平台公钥，就能从根本上拒绝一切“非付费”白嫖流量。
3.  **高可用探测探针 (Liveness Health Check)**：增加了 `health_check` 字段。参考 Google/AWS 等大厂网关做法，平台会以极低频率探活。一旦卖家进程挂掉，网关自动将其从流量池中摘除，阻断买家请求被路由到死节点上，从此杜绝“买家发起了请求 -> 超时 -> 执行区块链退款锁” 这种浪费平台手续费和算力的无效操作！
4.  **计费粒度与卖家承载水位 (Pricing Type & QoS)**：加入了 `type: "per_call"` 为日后流式 `per_1000_tokens` 或 `per_mb` 高级计费打底。更致命的是加入了 `max_qps: 50`；网关知道了卖家的最高并发承载力，当全网突然出现爆流调用时，网关直接按漏桶限流拦在平台层，**保护卖家的破破旧旧的小服务器不会直接被 DDoS 击穿宕机**！
5.  **终结大模型幻觉 (Anti-Hallucination)**：AI Agent 经常会瞎编参数（比如自创一个分类 `category="alien"` 引发卖家后端报错 400）。通过加入严苛的 `enum`，大模型在生成 Function 调用时会被强行圈定在合法选项内，极大地提高了跨机器 M2M 握手成功率！
6.  **防低频爆刷与成本防御 (Cost Limits)**：设定 `maxLength` 与 `max_response_bytes`。既防止卖家被恶意丢来的 10MB 超大文本挤爆内存，也锁死了大模型生成的 Token 开销。兜底了买方明确知道自己的 `0.01 USDC` 最多买什么边界的数据。

**意图路由 (Semantic Routing)**：买方的 Agent 代码只需告诉客户端“我想找处理 ` intent="名人名言" ` 的接口”。它甚至不用记住生涩的 `service_id`，系统做语义匹配寻找外挂突触。
2.  **Schema to Tool (动态生成大模型工具)**：买方的 AI 拿到上述中的 `input_schema` 后，可以直接装填进 OpenAI 或 DeepSeek 的 function calling (Tools) 参数中。Agent 会依靠大模型的自然语言推断，无缝处理长度限制与枚举选择，从而实现**完全零代码硬编码的 M2M 发掘与调用**！

**针对上述 Manifest，买家 Agent 或客户端向网关发起的最终调用范例 (Curl)：**
```bash
curl -X POST https://gateway.synapse.network/api/v1/gateway/generate \
  -H "X-Agent-Credential: agt_5f3b2a19..." \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "名人名言",
    "payload": {
      "text": "想要放弃的时候，请给我一句关于坚持的名人名言"
    }
  }'
```
*(注：网关收到此请求后，会根据 `intent` 配合上面 Manifest 的计费信息原子级预扣除 `0.01 USDC`，然后剥离系统字段，仅将 `payload` 作为干净的 Body 黑盒透传给卖家的真实 `endpoint`。)*


### 5.4 详细使用规约与生态全生命周期 (Lifecycle of Service Manifest)

这份 Manifest 就是跨越 AI 智能体之间“通讯障碍”的**赛博世界语**。它的使用与执行周期分为三个极致流畅的阶段：

#### 阶段一：卖家纯粹算力释放与上架 (Seller Onboarding)
1. **纯粹开发**：卖家在自己的服务器（如 `seller.ai-domain.com`）写一个简单的 POST 接口，只要处理入参、吐出回参。**彻底免去集成复杂的 Web3 鉴权、并发锁与 USDC 清算代码**的烦恼，专注模型或数据本身的质量。
2. **写下“自荐信”**：卖家只需配置上面的 `Manifest JSON` 文件，定义好业务路由 (`endpoint`) 和单次计价 (`pricing`)，并打好业务标签 `intent`（如分类为：`["名言", "写作"]`）。
3. **插上网络查线**：卖家在 Synapse Dashboard 或通过 CLI 发布此 Manifest。该节点的突触（Synapse）正式接入全网流动性枢纽。

#### 阶段二：买方动态服务发现 (Buyer Discovery)
买家（如 LangChain 里的 Agent）无需显式硬编码（Hardcode）调用 URL，更不用手写参数检查：
1. **意图路由下发**：买方 Agent 仅需“凭意图”寻找外挂大脑：`GET /api/v1/services/discover?intent=名人名言`。
2. **获悉入参契约 (Pull Schema)**：网关动态吐出这个卖家的 Manifest 元文件。
3. **Zero-Code 工具装填 (核心降维打击)**：买方的核心大脑（OpenAI/DeepSeek 等）直接读取 `description` 与 `input_schema`。大模型内部原生支持把 JSON Schema 当做 Function Calling Tool 吞下，并在瞬间掌握了**该如何调用这个世界上完全陌生的 API**！

#### 阶段三：黑盒组装与秒级 M2M 结算 (Dynamic Invocation)
1. **大模型自动配参**：用户随便说一句“我好崩溃求安慰”，Agent 的大模型会根据刚才拿到的 `input_schema`，精准地将其转换并打包出 JSON Payload `{"text": "安慰崩溃情绪的励志语"}`。
2. **请求过闸**：买方拿上 `payload` 和买方 API Key 轰向网关（如上面的 Curl）。
3. **光速清算 (Lightning Settlement)**：
   * 网关毫秒级核对买家在以太坊/L2 的 Dumb Vault USDC 余额。
   * 走去中心化记账后，向卖家的接口开火。
   * 卖家节点把处理好的名言警句塞回来，网关记下 `$0.01` 入账日志，并把终态内容回抛买家。
整个机器到机器（M2M）的“查广告 - 开发票 - 拿服务”一气呵成，完全由代码动态完成闭环！

### 5.5 卖家端防护与防白嫖机制设计 (Gateway-to-Seller Auth)

买方既然必须付费给网关才能调用 API，那就必须坚决防止黑客绕开网关，直接发现并拿着卖家的公网 URL (`https://seller.ai-domain.com/...`) 裸调“白嫖”，甚至进行恶意并发将卖家击穿。

为此，平台采用类似 Stripe / Slack Webhook 的行业标杆级 **HMAC-SHA256 签名机制**。

#### 1. 核心运行原理
*   **分配密钥**：卖家在 Synapse 平台成功注册 Service Manifest 后，平台会为其唯一生成并下发一个 **`Seller_Secret_Key`**（网关与卖家共享的对称鉴权密钥，卖家需仅将其妥善配置在自己服务器的环境变量中）。
*   **网关担保签名**：网关在完成“验资扣费”后，向卖家物理节点转发 Payload 时，会基于本次请求的具体体量和当前时间动态生成一个密码学签名，并注入到 HTTP Header 中透传给卖家。
*   **极简验签**：卖家服务端通过不超过 15 行的校验代码，只要 HMAC 比对成功，就证明该计算任务**100% 来源于网关，且已结算完毕**。

#### 2. X-Synapse-Signature 结构设计
网关发往卖家的请求 Header 会强制包含此键值对：
```http
X-Synapse-Signature: t=1712400000,v1=5257a869e7ecebea0d1550d6ef1234...
```
*   `t`: 网关发起转发请求时的 Unix 时间戳（秒级）。
*   `v1`: 使用 HMAC-SHA256 算法生成的十六进制 Hash 签名。

#### 3. 签名生成与拦截算法 (卖家侧必做三步)
卖家获取到带上述 Header 的 POST 请求后，需经过下面三个标准动作以执行无情拦截：

**Step 1: 防重放校验 (Timestamp Check)**  
解析出 Header 中的 `t`，与服务器当前系统时间做差值对比。若 `|current_timestamp - t| > 300秒(即 5 分钟)`，毫不犹豫地丢弃并返回 `HTTP 401 Unauthorized`。
*防线意义*：彻底阻断黑客截获了过去的合法报文，然后再一秒内向卖家狂发一万次，试图耗尽卖家云资源的“重放攻击 (Replay Attack)”。

**Step 2: 组装签名载荷 (Prepare Payload)**  
将提取到的时间戳 `t`，加上英文句号 `.`，再**原封不动地拼接请求的 Raw Body (真实的原始 JSON HTTP 请求体字符串)**。
即：`signed_payload = "1712400000" + "." + '{"request_id":"...","payload":{...}}'`
*(注：为了避免 JSON 序列化各种库去空格不同导致 Hash 雪崩，卖家拦截器必须拦截原始字节/字符串格式进行计算。)*

**Step 3: Hash 计算与恒定比对 (HMAC Verification)**  
使用保管好的 `Seller_Secret_Key` 对这串载荷进行 HMAC-SHA256 哈希计算。
如果算出的 Hash 完美匹配 Header 中的 `v1` 数据，就代表**此请求绝非伪造，安心处理并返回结果**；凡是不一致，无论是 1 个字节的数据被篡改，还是密钥不对，皆返回 `HTTP 403 Forbidden`。

#### 4. 可选的降维物理防御 (网络层 IP 白名单)
对于具备较高运维能力、且只提供 API 不对外构建 Web 前端的深度卖家，除了上述代码拦截，还可以使用更暴力的“降维防御”：
平台将公开对外发起反向代理代理的**网关 VPC 出口弹性 IP 列表**。卖家可直接在云安全组、Nginx 或 iptables 中配置**仅白名单**（Allow list），将 Synapse 以外的所有入方向公网 IP 直接 `DROP` 拒绝链接。这做到了从网络层到代码业务层的“双保险”。

---

## 6. 终极图景：只服务业务的赛博节点
在这个协议设计下，卖家（AI 开发者、数据提供商）变成了单纯的数学模型——只需专注炼丹、提炼纯粹的业务价值；不再需要与 Web3 钱包打交道、不用防并发、更不需要研发账户与充值系统。  
只要你的 Manifest 插进网关，你的接口就是整个 Synapse 网络的一枚可用突触（Synapse）。任何游荡的买方 Agent 都能靠自然语言定位你，而 USDC 会因为优质的高频调用，持续汇入你的金库。这就是印钞机般的基础设施的美学！