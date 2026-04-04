# Reference

- Status: canonical
- Code paths: `gateway/src/api/`, `gateway/src/services/`, `sdk/python/`, `provider_service/`, `docs/06_Reference/`
- Verified with: `npm run ci:pr`, `npm run ci:docs`
- Last verified against code: 2026-03-25

本目录收敛 Synapse 面向实现者和集成者必须稳定理解的参考契约。

这里不承担产品叙事和流程说明，而是聚焦“稳定机器语义与开发事实”：

1. API 合约如何看
2. 错误码枚举与响应结构如何分层处理
3. Service Manifest 与 Runtime 对象如何建模
4. 开发、测试、集成时的最低共识是什么

## 真理源

本目录以以下来源为准：

1. `docs/06_Reference/05_Runtime_API_Contract.md`
2. `docs/06_Reference/06_Runtime_Error_Code_Catalog.md`
3. `docs/03_Core_Workflows/02_Discovery_and_Gateway_Call.md`
4. `docs/admin/Admin_API_Contract_Phase1.md`
5. `docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`
6. `docs/02_System_Architecture/03_Identity_Authentication_and_Risk_Control.md`
7. `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`
8. `docs/04_Database_Design/`
9. `docs/provider_service/api/README.md`
10. `../sdk/README.md`

说明：旧 `06_Developer_Guides/` 中的开发、测试、SDK 有效内容已收敛进本模块，不再保留为主引用源。

## 阅读顺序

1. `01_API_Contract_Index.md`
2. `05_Runtime_API_Contract.md`
3. `02_Error_Code_and_Runtime_Response_Contract.md` 先看错误响应与消费原则
4. `06_Runtime_Error_Code_Catalog.md`
5. `03_Service_Manifest_and_Runtime_Object_Reference.md`
6. `04_Development_Testing_and_Integration_Reference.md`
7. `AI_Quick_Reference.md`
8. `Validation_Entry_Points.md`

## 模块边界

本目录不承担：

1. 产品定位：看 `docs/01_Product_Frontend/`
2. 系统架构：看 `docs/02_System_Architecture/`
3. 业务流程：看 `docs/03_Core_Workflows/`
4. 部署运维：看 `docs/05_DevOps_Deployment/`

## 核心结论

Reference 模块的职责，是把 Synapse 的关键外部契约压缩成可实现、可测试、可集成的稳定事实，而不是继续让信息散落在历史指南里。

新增的 AI 参考入口承担两项补充职责：

1. `AI_Quick_Reference.md` 用最小上下文压缩仓库核心事实、项目边界与优先阅读路径。
2. `Validation_Entry_Points.md` 明确当前项目级与仓库级验证入口，降低 AI 和人类重复搜索命令的成本。