# Gateway Application Logging Standard

## 1. 文档目标

本文档定义 Platform Gateway 的应用级日志接入规范，确保请求、转发、风控、结算在运行时可观测，但不会泄露密钥、令牌和内部结构。

## 2. 日志框架要求

推荐使用支持结构化输出、异步写入和上下文绑定的日志框架。

最低能力要求：

1. JSON 序列化输出
2. request-scoped context 绑定
3. 异步写入队列
4. 文件轮转与保留策略
5. 敏感字段脱敏

## 3. 每条应用日志至少包含

1. `timestamp`
2. `level`
3. `request_id`
4. `action`
5. `owner_id` 或等价 scope
6. `service_id` 或 `provider_id`
7. `latency_ms`

## 4. 日志动作分类

1. `request_enter`
2. `auth_decision`
3. `quote_validation`
4. `forwarding_start`
5. `forwarding_error`
6. `billing_capture`
7. `billing_release`
8. `risk_decision`
9. `request_exit`

## 5. 中间件责任

全局中间件应统一负责：

1. 生成或接收 `request_id`
2. 注入 request context
3. 输出入口日志与结束日志
4. 把 `X-Request-Id` 回写到响应头

业务处理器只负责记录关键业务节点，不重复写通用进出日志。

## 6. 安全要求

1. 禁止打印 token、secret、signature、私钥材料。
2. 错误日志只暴露安全表面，不暴露内部 SQL、堆栈或 schema。
3. 对外响应与内部日志要分层，日志可详细，但必须脱敏。

## 7. 设计结论

应用日志的目标不是“尽可能多打印”，而是让每次调用都能在不泄密的前提下快速定位到 `谁在调用、调用了什么、花了多少钱、卡在了哪一层`。
