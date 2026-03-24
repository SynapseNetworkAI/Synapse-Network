# provider_service Hard Rules

本文件是 `provider_service` 目录下的本地 Agent 执行镜像。

## Canonical Sources

1. `docs/AGENTS.md`
2. `.github/instructions/python.instructions.md`
3. `docs/03_Projects/provider-service/Provider_Service_Agent_Rules.md`

## Role Boundary

1. `provider_service` 是独立 Provider runtime，不承担 gateway 结算、Owner 预算、链上资金托管或后台控制面职责。
2. 它负责 provider 自己的 API runtime、调用编排、结果返回，以及必要的 provider-side observability。
3. 如果需求把它推向 gateway 或 admin 职责，说明边界错了，必须停下来重构方案。

## Local Constraints

1. 本地运行只使用项目虚拟环境：`./.venv/bin/python`。
2. 项目说明、接口规范与运行手册继续使用 Markdown，不要把文档职责塞进 JSON。
3. 任何 observable 行为变化都要同步更新项目文档与测试。
4. `provider_service` 的业务编排、领域对象、存储接口必须优先使用面向对象和显式类型，不要把长期业务数据建模成裸 `dict` 或随意拼 JSON。
5. 存储层必须通过 repository / storage object 暴露 typed methods，不允许把 runtime repository 写成 `dict in / dict out` 的临时脚手架。
6. Repository 不允许在运行时偷偷执行建表、补列、自动迁移；DDL 统一通过显式 SQL 初始化链路或迁移脚本管理。

## 文档入口

1. `docs/03_Projects/provider-service/README.md`
2. `docs/03_Projects/provider-service/Provider_Service_Local_Development.md`
3. `docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md`
4. `docs/provider_service/README.md`

## 最小验证

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
./.venv/bin/python -m pytest tests -q
```