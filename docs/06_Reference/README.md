# Reference

本目录收敛 Synapse 面向实现者和集成者必须稳定理解的参考契约。

这里不承担产品叙事和流程说明，而是聚焦“稳定机器语义与开发事实”：

1. API 合约如何看
2. 错误码和响应结构如何处理
3. Service Manifest 与 Runtime 对象如何建模
4. 开发、测试、集成时的最低共识是什么

8. `docs/sdk/README.md`
## 真理源

本目录以以下来源为准：

1. `docs/api.md`
2. `docs/Gateway_Error_Codes.md`
3. `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
5. `../sdk/README.md`
4. `docs/agent/03_Service_Manifest_Field_Standard.md`
5. `docs/agent/04_Credential_Budget_Risk_Model.md`
6. `docs/agent/07_Agent_SDK_Integration_Guide.md`
7. `docs/04_Database_Design/`

说明：旧 `06_Developer_Guides/` 中的开发、测试、SDK 有效内容已收敛进本模块，不再保留为主引用源。

## 阅读顺序

1. `01_API_Contract_Index.md`
2. `02_Error_Code_and_Runtime_Response_Contract.md`
3. `03_Service_Manifest_and_Runtime_Object_Reference.md`
4. `04_Development_Testing_and_Integration_Reference.md`

## 模块边界

本目录不承担：

1. 产品定位：看 `docs/01_Product_Frontend/`
2. 系统架构：看 `docs/02_System_Architecture/`
3. 业务流程：看 `docs/03_Core_Workflows/`
4. 部署运维：看 `docs/05_DevOps_Deployment/`

## 核心结论

Reference 模块的职责，是把 Synapse 的关键外部契约压缩成可实现、可测试、可集成的稳定事实，而不是继续让信息散落在历史指南里。