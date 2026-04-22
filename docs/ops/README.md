# DevOps and Deployment

- Status: canonical
- Code paths: `docker-compose/`, `scripts/`, `tools/`, `package.json`
- Verified with: `npm run ci:pr`, `npm run ci:docs`
- Last verified against code: 2026-03-25

本目录定义 Synapse 的本地环境、CI/CD、生产运维、观测、索引器运行与金融事故响应基线。

这里不再用“脚本散落 + 历史 runbook 混排”的方式组织，而是按真正的交付问题组织：

1. 本地和环境如何拉起
2. CI/CD 和发布门禁如何工作
3. 生产运行如何观测、巡检、补扫与恢复
4. 金融级异常如何止损、排查与复盘

## 真理源

本目录的约束来源：

1. `docs/AGENTS.md`
2. `docs/06_Reference/05_Runtime_API_Contract.md`
3. `docs/04_Database_Design/`
4. `docs/admin/`

补充说明：

1. former root `docs/平台资金监控方案.md` 的运行时观测语义已收口到本模块；历史迁移情况统一回看治理记录与 completed plans。

说明：本模块已吸收旧运维与开发指南中的当前有效内容，退役目录不再作为主引用源。

## 阅读顺序

1. `01_Local_Environment_and_Runtime_Setup.md`
2. `02_CI_CD_and_Release_Gates.md`
3. `03_Observability_Logging_and_Indexer_Operations.md`
4. `04_Financial_Incident_Response_and_Production_Operations.md`
5. `05_Discovery_Service_Troubleshooting_SQL.md`
6. `06_Python_Environment_and_Venv_Strategy.md`
7. `09_Staging_First_GCE_Rollout.md`
8. `10_Production_Go_No_Go_Security_Verification.md`
9. `11_Performance_and_Reliability_Verification.md`
10. `12_Gateway_Pre_Launch_Stress_Review.md`
11. `13_Production_Monitoring_Alerting_and_Backup_Restore.md`
12. `14_Gmail_Email_Notifications.md`
13. `15_Google_Cloud_Launch_Readiness.md`
14. `16_Arbitrum_Sepolia_Staging_Contracts.md`
15. `17_In_App_Notifications.md`
16. `../security/README.md`

## 模块边界

本目录不承担：

1. 产品信息架构：看 `docs/01_Product_Frontend/`
2. Runtime 主流程：看 `docs/03_Core_Workflows/`
3. 数据模型和 SQL：看 `docs/04_Database_Design/`
4. API 契约、错误码、Manifest 标准：看 `docs/06_Reference/`

## 核心结论

Synapse 的 DevOps 不是“把服务跑起来”这么简单，而是：

**让 Gateway、Indexer、Ledger、Vault、Admin 在同一套可回滚、可审计、可观测、可发布的纪律中运行。**
