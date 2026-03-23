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