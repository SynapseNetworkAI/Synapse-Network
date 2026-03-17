# Service Manifest 注册补充说明

> 状态更新（2026-03-17）：Service Manifest 的 canonical 字段标准已经统一收敛到 `docs/agent/03_Service_Manifest_Field_Standard.md`。
>
> 本文件只保留 Seller 注册输入如何映射到 canonical Manifest 与 Gateway 内部扩展字段的实现补充，不再定义第二套协议。

## 1. 本文档的边界

先看 canonical：

1. `docs/agent/03_Service_Manifest_Field_Standard.md`
2. `docs/api.md`

本文只解释三件事：

1. Seller 在后台录入的字段如何映射到 canonical Manifest。
2. 哪些字段只属于 Gateway 内部扩展，不直接暴露给 Agent。
3. 当前实现里哪些约束和策略仍值得保留为落地说明。

## 2. 当前映射规则

### 2.1 应映射到 canonical Manifest 的字段

| Seller 注册输入 | Canonical Manifest |
| --- | --- |
| `serviceName` | `service_name` |
| `summary` | `description_for_model` |
| `pricing.amount` | `base_price_usdc` |
| `pricing.currency` | `settlement_currency` |
| `invoke.request.schema` | `input_schema` |
| `invoke.response.schema` | `output_schema` |
| `invoke.url` | `endpoint_url` |
| `invoke.timeoutMs` | `timeout_ms` |
| `isActive / status` | `status` |

### 2.2 只属于 Gateway 内部扩展的字段

以下字段应收敛到 `gateway_extensions`，不要混进 Agent-facing 最小契约：

1. `healthCheck`
2. `invoke.targets`
3. `forwarding`
4. `metering`
5. `constraints.maxQps`

这些字段服务的是：

1. 健康检查
2. 多 target 路由
3. 头部透传、重试、请求追踪
4. 计费与限流策略

## 3. 当前仍有效的实现结论

### 3.1 `serviceId` 由系统生成

这个结论继续有效：

1. Seller 不应该手填 `serviceId`。
2. `serviceId` 应由平台生成，创建后不可变。
3. Seller 提交的是业务语义，不是内部主键。

### 3.2 对外 discover 不暴露 Seller 上游地址

这个原则也继续有效：

1. Seller 注册时可以填写真实上游 `invoke.url` 或多个 `targets`。
2. 但 Discovery / Quote / Invoke 对 Agent 暴露的始终应是平台网关入口，而不是 Seller 内网或真实 origin。

### 3.3 运行约束应作为平台硬约束执行

如果 Seller 注册了请求大小、响应大小、超时、QPS 等约束，Gateway 在运行时应真正执行，而不是只存文档：

1. `maxQps` 命中时返回 `SERVICE_QPS_EXCEEDED`
2. `maxRequestBytes` 命中时返回 `REQUEST_PAYLOAD_TOO_LARGE`
3. `maxResponseBytes` 命中时返回 `RESPONSE_PAYLOAD_TOO_LARGE`
4. `timeoutMs` 作为平台转发超时上限之一

### 3.4 多 target 路由属于平台内部能力

如果 Seller 注册了多个 `targets`：

1. Gateway 可以基于健康度和 `weight` 做内部选路。
2. Agent 不需要也不应该看到 Seller 真实 target 列表。
3. 如果 target 配置非法，应回到平台内部配置错误语义，而不是让 Agent 感知 Seller 内部拓扑。

## 4. 本文档不再承担的职责

以下内容已经不是本文件的职责范围：

1. 单独定义新的注册 API 版本。
2. 重新定义 Runtime 鉴权模型。
3. 把 Provider Secret / Service Key 视为 Agent Runtime 主凭据。
4. 把 Seller 控制面字段直接冒充成 Agent-facing 协议字段。

这些都要回到 `docs/agent/03_Service_Manifest_Field_Standard.md`、`docs/agent/04_Credential_Budget_Risk_Model.md` 和 `docs/api.md`。
