# Build-for-Agent Architecture Map

本目录现在只承载 build-for-agent 主线设计，不再继续兼容旧角色对照心智，也不再保留“新旧方案对照稿”的叙事结构。

统一角色口径：

1. `Owner`：租户根身份，负责入金、授权、创建 Agent、管理 Provider 工作区。
2. `Agent`：Owner 授权出的运行时执行体，负责 Discovery / Quote / Invoke。
3. `Provider`：Owner 在供给侧扮演的业务角色，负责注册服务、运营定价、查看收益、申请提现。
4. `Platform`：系统内部执行层，负责鉴权、路由、风控、记账、审计、清算。

推荐阅读顺序：

1. `High_Frequency_MicroPayment_V2.md`
   - build-for-agent 资金与运行时主架构。
2. `FastAPI_Synchronous_Payment.md`
   - Owner 入金、Agent 同步调用、Provider 返回结果的标准主路径。
3. `API_Gateway_Reverse_Proxy.md`
   - 网关如何做鉴权、预扣费、健康路由、Provider 转发和防绕过。
4. `Financial_Production_Security.md`
   - 生产级资金安全基线、幂等、事务、审计、运行时状态边界。
5. `Gateway_Financial_Risk_Control_Design.md`
   - 充值、消费、退款、Provider 提现、人工审核、流动性风控的整体策略。
6. `Gateway_Logging_Architecture.md`
   - request id、计费日志、对账日志、审计日志的事实链设计。
7. `Gateway_Application_Logging.md`
   - 应用日志接入规范和结构化日志实现口径。
8. `Financial_Security_Incident_Runbook.md` 与 `Phase5_Liquidity_Alert_SOP_Implementation.md`
   - 事故响应和人工审核 SOP。

阅读规则：

1. 本目录默认用 `consumer balance / provider receivable / platform fee` 这类目标态语义表达资金桶。
2. 文档以目标态设计为准，不再保留旧接口字段名解释、旧账户模型解释、旧角色对照说明。
3. 若代码仍存在历史命名，视为待重构实现细节，不再作为架构文档的组织中心。
