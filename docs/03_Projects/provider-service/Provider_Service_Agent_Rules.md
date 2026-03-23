# Provider Service Agent Rules

## Role

1. `provider_service` 是独立部署的 Provider 微服务样板工程。
2. 它对外提供稳定、可测试、可扩展的 Provider API。
3. 它不承担网关结算、预算、钱包、账本和服务注册控制面。

## Source Of Truth

1. 仓库级总规范以 `docs/agents.md` 为准。
2. 本文件是 `provider_service` 子项目的 canonical 工程规则。
3. 如果本文件与仓库级规范冲突，优先遵循仓库级规范，再同步修正本文件。

## Project Index

### Current Runtime Files

1. `provider_service/README.md`: 项目入口壳文件。
2. `provider_service/agents.md`: 本地 Agent 执行镜像。
3. `provider_service/requirements.txt`: Python 依赖。
4. `provider_service/.env.example`: 环境变量模板。
5. `provider_service/start.sh`、`stop.sh`、`restart.sh`: 运行脚本。

### Canonical Docs

1. `docs/03_Projects/provider-service/README.md`
2. `docs/03_Projects/provider-service/Provider_Service_Local_Development.md`
3. `docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md`
4. `docs/provider_service/README.md`
5. `docs/provider_service/SERVICE_DRAFTS.md`
6. `docs/provider_service/api/*.md`

### Application Layout

1. `provider_service/app/main.py`: FastAPI 入口。
2. `provider_service/app/core/config.py`: 配置加载。
3. `provider_service/app/api/v1/router.py`: v1 聚合路由。
4. `provider_service/app/api/v1/endpoints/quotes.py`: 当前名言 demo 路由。
5. `provider_service/app/schemas/quote.py`: 请求与响应模型。
6. `provider_service/app/services/deepseek_client.py`: 当前本地 JSON 数据源服务封装。
7. `provider_service/app/data/famous_quotes_100.json`: 本地测试数据，仅允许作为 fixture。

### Tests

1. `provider_service/tests/test_quote_local_json.py`

## Architecture Rules

### Layering

1. `app/api/`: 路由挂载、参数接收、错误映射、响应返回。
2. `app/schemas/`: Pydantic 请求/响应模型，不写业务逻辑。
3. `app/services/`: 业务编排、数据源访问、缓存策略、规则计算。
4. `app/core/`: 配置、日志、中间件、通用基础设施。
5. `app/data/`: fixture、本地 mock 数据、静态样本，不放设计文档。
6. `tests/`: 自动化回归测试。

### Boundary

1. 不直接实现 Gateway 内部账本、预算、结算、服务发现规则。
2. 通过稳定 HTTP API 向 Gateway 暴露能力，不与 Gateway 内部模块强耦合。
3. 新增服务时优先保持统一接口骨架：健康检查、请求模型、标准响应、错误码、日志链路。

## Coding Rules

### TDD First

1. 新增接口、修改 schema、替换数据源、改变错误码时，必须先写测试或同批补测试。
2. 没有测试的行为变更，视为未完成。
3. 测试要覆盖正常路径和失败路径，不能只测 happy path。

### DRY First

1. 相同请求解析、错误映射、数据源访问、日志绑定、响应拼装，必须抽公共函数或服务层方法。
2. 禁止在多个 endpoint 中复制相同业务代码。
3. 禁止把常量、路径、source/model 字段散落硬编码在不同文件。

### OOP And Domain Modeling

1. 数据源客户端、规则引擎、缓存适配器、Provider 业务实现，优先封装为清晰对象或服务类。
2. 路由层不要直接操作底层细节；通过服务对象调用完成业务。
3. 能用明确类型表达的对象，不要退化成裸 `dict` 和随意拼 JSON。

### Schema Explicitness

1. 所有对外请求和响应必须通过 Pydantic schema 定义。
2. 禁止直接返回未建模的原始 `dict` 作为长期接口契约。
3. 字段语义变化时，同步更新测试与文档。

### No JSON As Documentation

1. 禁止使用 JSON 文件承载项目说明、接口规范、字段说明、开发规则、表结构文档。
2. 设计文档、接口契约说明、运维说明统一使用 Markdown。
3. JSON 只允许用于 fixture、测试样本和真实 API 示例。

## Documentation Sync Rules

1. 代码变更后，必须同步更新相关 Markdown 文档。
2. 当前子项目至少保持以下内容一致：
   - `provider_service/README.md`
   - `provider_service/agents.md`
   - `docs/03_Projects/provider-service/Provider_Service_Local_Development.md`
   - `docs/03_Projects/provider-service/Provider_Service_Operations_Runbook.md`
   - `docs/03_Projects/provider-service/Provider_Service_Agent_Rules.md`
   - `docs/provider_service/*.md` 中对应设计说明
3. 如果运行时还是 demo，但设计文档描述未来 5 个服务，必须明确区分“当前实现”和“目标设计”。

## Code / Docs / Table Structure Sync

1. 未来一旦引入数据库表、缓存表或审计表，必须遵守代码、文档、表结构三同步。
2. 字段新增、删除、重命名，至少同步：
   - Pydantic schema
   - 对应 service / repository 实现
   - Markdown 字段说明或表结构说明

## Validation Commands

最小测试命令：

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
./.venv/bin/python -m pytest tests -q
```

最小本地运行检查：

```bash
cd /Users/cliff/workspace/Synapse-Network/provider_service
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
curl http://127.0.0.1:8100/health
```

## Stop Conditions

1. router 出现业务逻辑，停止并下沉到 service。
2. schema 开始承载业务逻辑，停止并重构。
3. 同一业务规则在两个 endpoint 重复实现，停止并抽象。
4. 接口行为变了但测试没变，停止并补测试。
5. 文档仍引用旧路径、旧接口事实，停止并修正文档。