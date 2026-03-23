# Drift Checklist

## 1. Purpose

本文件是 Synapse 文档漂移的最小检查清单。

当改动影响 API、数据库、运维、项目结构或控制面语义时，结束前至少过一遍这里。

## 2. Universal Checks

所有行为变化都检查：

1. 代码是否已经反映新行为
2. 测试是否断言新行为
3. 对应 canonical 文档是否已更新
4. `docs/README.md` 和 `llms.txt` 是否仍能把读者带到正确入口
5. 是否还有旧文档在描述被替代语义

## 3. API And Contract Changes

如果改动涉及 request / response / status / error：

1. 检查 router / schema / tests
2. 更新 `docs/06_Reference/`
3. 更新受影响的流程文档
4. 如果 SDK 受影响，更新 `sdk/python/` 和对应参考文档

## 4. Database And Finance Changes

如果改动涉及 schema / ledger / settlement / provider receivable / withdrawal：

1. 先检查 SQL bootstrap 与 migration
2. 再更新 `docs/04_Database_Design/`
3. 再更新 `docs/03_Core_Workflows/`
4. 如果 admin 投影受影响，更新 `docs/admin/` 与 admin API contract

## 5. DevOps And Validation Changes

如果改动涉及脚本、CI、启动命令、环境变量：

1. 检查真实脚本和 package.json 命令
2. 更新 `docs/05_DevOps_Deployment/`
3. 更新 `docs/03_Projects/<project>/`
4. 更新 `docs/06_Reference/Validation_Entry_Points.md`

## 6. Frontend And IA Changes

如果改动涉及页面路径、信息架构、控制面状态展示：

1. 更新 `docs/01_Product_Frontend/`
2. 更新对应项目页 under `docs/03_Projects/`
3. 检查是否有旧 IA / 旧命名文档仍在主路径中

## 7. Structural Docs Changes

如果新增、移动、归档文档：

1. 确认新文档状态是 `canonical` / `supplementary` / `incubation` / `legacy` / `archive` 之一
2. 确认它已经被索引到正确入口
3. 确认它没有和现有 canonical 文档并列重定义同一主题
4. 确认旧文档有 redirect、banner 或替代说明