# 网关计费与异常扣费协议设计 (API Billing & Deduction Protocol)

## 1. 核心哲学：基础设施的克制与边界

在 M2M（机器对机器）时代的微支付网络中，**“精准计费”** 决定了平台的公信力，而 **“低摩擦接入”** 决定了平台的生死。

### 1.1 为什么我们**拒绝**强制下游使用 `{ "code": 0, "data": {} }`？

在传统的 Web2 内部微服务通信中，强制统一包裹 JSON 结构（即永远返回 HTTP 200，用内部状态码表示业务成功/失败）是非常常见的做法。但作为 **全球级 AI Agent 基础设施**，我们不能这么做：
1. **接入摩擦力极大（Friction）**：如果要求所有 Provider 改写他们的网关，把原生符合 OpenAI 规范的格式强行包一层 `code: 0`，这将是灾难性的开发者体验。我们应该去适配这个世界，而不是逼这个世界为我们写特供版代码。
2. **破坏 RESTful 与 HTTP 原生降级**：当基础设施出现问题（如 Nginx 限流返回 429）、服务器宕机（502/503），下游是不可能给你包装出带有 `code: 0` 的 JSON 的。
3. **流式响应（Streaming）的冲突**：AI 应用大量依赖 Server-Sent Events (SSE) 流式传输（Chunked），这种机制下根本无法在开头包裹常规 JSON。

### 1.2 我们的铁律：以 HTTP 原生语义（Status Code）为计费锚点
**“Code is Law，但 Network Protocol is Foundation”**
我们尊崇 HTTP 标准：**只要是 200~299 状态码，我们就认为这笔交易在技术与业务上均“成功交付”，发生真实扣除。400 以上（或网络彻底不通）均判定为失败，保证买家 0 扣费**。

---

## 2. 计费原子操作：两阶段提交模型 (TCC - Reserve & Commit)

为了防止并发环境下的“超扣（Overdraft）”或“错扣”，网关执行以下两阶段计费流：

### 阶段一：拦截与预冻结 (Reserve/Hold)
当一笔 API 请求来到 Synapse Network Gateway：
1. **鉴权与余额检查**：提取 `Bearer <API_KEY>`，根据拓扑追溯至主钱包余额。
2. **预扣费（Redis Row-level Lock）**：比如该服务定价为 0.05 USDC/次，网关在 Redis 中临时冻结钱包的 0.05 USDC 额度（记录一条 Pending 扣费预授权交易）。这一步耗时在 **1 毫秒** 级别。

### 阶段二：上游调用与结算 (Upstream & Settle)
网关向下游 Provider 发起真实的数据请求，并监听返回结果。

| 场景事件 (Scenario) | 现象 (Symptom) | 计费动作 (Billing Action) | 资金流向 |
| :--- | :--- | :--- | :--- |
| **A. 上游网络断联 (Upstream Error)** | Gateway 返回 502/504、DNS 失败、Connection Refused | **Rollback (回滚)** | 买家余额解冻，无资金扣减。系统自动返回带有签名的标准异常响应给买家。|
| **B. 客户端主动中断 (Client Abort)** | 买家发送到一半断开连接 | **Rollback (回滚)** | 未实际触达或未完整响应，保护买家。 |
| **C. 上游业务拒绝 (Downstream 4xx/5xx)**| Seller API 返回 HTTP 400, 429, 401, 500 等报错信息 | **Rollback (回滚)** | 买家虽然发起了调用，但未得到有效服务，平台拒绝对此次调用进行结账。|
| **D. 成功交付 (HTTP 200/SSE 正常)** | Seller API 正常返回结果，HTTP Status 2xx | **Commit (确认扣款)** | 将 Redis 的 Pending 转化为确定的 ledger 扣减，同步持久化记录（供链上定时对账与发薪）。 |

---

## 3. 远期扩展设计：弹性计费协议 (Dynamic Billing Headers)

目前我们实行的是“以 HTTP 200 判定一口价自动扣费”。但对于复杂的 AI 应用，“一口价”迟早无法满足**按 Token 计费**的需求。

为此，Synapse Network 将在原生 HTTP 层之上，为上游服务商（Sellers）提供**可选的（Optional）自定义计费头部协议 (Synapse Network-Billing-Headers)**：

如果下游 Seller 的 API 接入时配置了 `Dynamic Pricing (动态计价)` 模式，那么扣款金额不再是固定值，而是由 Seller 在返回 HTTP 200 响应时，在 Response Header 中告知网关：

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Synapse Network-Charge-Amount: 0.025
X-Synapse Network-Usage-Tokens: 1540
```

1. **按需补扣/退还**：网关在阶段一时，先按该服务的“最高限量（Max Limit / Deposit）”冻结（例如冻结 0.1 USDC）。当收到 `X-Synapse Network-Charge-Amount: 0.025` 时，网关只需 Commit 0.025 USDC，并将剩余的 0.075 USDC Rollback 退还。
2. **商户主动免单**：哪怕 HTTP 是 200，如果商户认为这次回答质量太差或自身业务逻辑做了拦截，也可以传回 `X-Synapse Network-Charge-Amount: 0`，网关将**全额退款**。

## 4. 总结 (TL;DR)

- **坚决不搞带有大厂遗毒的闭环 JSON (如 `{code:0}` )**。
- **上游只要死机、超时、报错(4xx/5xx)，买家绝不扣费。** 
- **网关采用 "预冻结 -> 查上游 -> 确定扣或者退"的 TCC 两步走模型。**
- **为 AI 提供极大自由度，未来通过 HTTP Headers 实现极其优雅的动态按 Token 计费。**