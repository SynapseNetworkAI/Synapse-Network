# Synapse Agent Design Index

> 产品原则：**Synapse is for agent, not for human.**
>
> 最终成功指标：**Agent completed first paid invocation autonomously.**

这份索引文档把 Agent Runtime 蓝图拆成 5 个专题文档，便于后续分别推进产品、后端接口、卖家挂载标准、风控与 Dashboard 设计。

## 文档目录

1. [01_Agent_Runtime_Product_Architecture.md](./01_Agent_Runtime_Product_Architecture.md)
  Agent Runtime 总体分层、主循环、核心对象、状态机、V1/V2 边界。

2. [02_Discovery_Quote_Invoke_API_Design.md](./02_Discovery_Quote_Invoke_API_Design.md)
  Discovery / Quote / Invoke 三段式 API 设计、请求响应结构、错误码与幂等要求。

3. [03_Service_Manifest_Field_Standard.md](./03_Service_Manifest_Field_Standard.md)
  Service Manifest 字段分层、推荐 JSON 结构、校验规则与 V1 最小必填集。

4. [04_Credential_Budget_Risk_Model.md](./04_Credential_Budget_Risk_Model.md)
  Credential / Budget 风控模型、预算账本、风控顺序、错误动作映射。

5. [05_Dashboard_IA_and_Onboarding.md](./05_Dashboard_IA_and_Onboarding.md)
  Dashboard 信息架构、首次 onboarding 流程、激活目标与页面核心模块。

6. [06_Build_For_Agent_Database_Rebuild.md](./06_Build_For_Agent_Database_Rebuild.md)
  旧 schema 哪些可复用、哪些必须删除重写、全新 Agent Runtime 数据库结构与表映射。

7. [07_Agent_SDK_Integration_Guide.md](./07_Agent_SDK_Integration_Guide.md)
  外部 Agent 如何通过 SDK 接入 Synapse，为什么主路径应是 SDK + Markdown contract，而不是 skill-first 或 CLI-first。

## 北极星与拆分原则

所有专题文档都服务同一个问题：

**这个模块，是否让 Agent 更容易完成第一次自主付费调用？**

如果某一块设计让人类反复切页面、手工选服务、逐次确认调用，那就说明设计偏了，必须回滚到 Agent First 原则。

## 推荐阅读顺序

1. 先读 Runtime 架构，明确系统边界。
2. 再读 DQI API，明确机器侧调用闭环。
3. 再读 Manifest 标准，明确卖家如何上架。
4. 再读风控模型，明确预算和安全边界。
5. 再读 SDK Integration Guide，明确外部 Agent 如何真正接入。
6. 最后读 Dashboard 和 onboarding，明确 Owner 控制台怎么承载这些能力。