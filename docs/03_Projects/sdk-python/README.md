# sdk-python

- Status: canonical
- Code paths: `sdk/python/`, `docs/03_Projects/sdk-python/`, `docs/sdk/`
- Verified with: `npm run ci:sdk-python`, `npm run ci:docs`
- Last verified against code: 2026-03-25

## 1. 项目定位

`sdk/python/` 是 Synapse 的官方 Python SDK 分发与联调目录。

它负责：

1. 封装 discovery / quote / invoke / receipt 运行时协议
2. 给 Agent 和集成方提供稳定的程序化客户端
3. 提供 smoke test、单测与打包发布入口

一句话：这是 Agent 运行时的官方 Python 插头。

## 2. 代码位置

- 项目目录：`sdk/python/`
- 包入口：`sdk/python/synapse_client/`
- 示例：`sdk/python/examples/smoke_test.py`
- 包说明：`sdk/python/README.md`
- 打包配置：`sdk/python/pyproject.toml`

## 3. 职责边界

`sdk/python/` 应该承担：

1. Runtime API 客户端封装
2. SDK 级异常映射、轮询和便捷 helper
3. 本地单测与真实链路 smoke test
4. Python 包发布与开发者接入体验

`sdk/python/` 不应该承担：

1. Gateway 服务端逻辑
2. Provider Runtime 实现
3. 后台控制面逻辑
4. 浏览器端前端页面

## 4. 直接依赖关系

1. 主要消费 `gateway/` 的 Agent Runtime API
2. 与 `provider_service/` 一起组成端到端 demo 调用链
3. 受根 `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md` 与 `docs/sdk/README.md` 约束

## 5. Canonical 文档入口

1. `docs/sdk/README.md`
2. `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`
3. `docs/06_Reference/01_API_Contract_Index.md`
4. `docs/06_Reference/05_Runtime_API_Contract.md`

## 6. 项目内贴身文档

根 `docs/03_Projects/sdk-python/` 当前集中维护：

1. [SDK_Python_Local_Development.md](./SDK_Python_Local_Development.md)

项目目录内保留：

1. `sdk/python/README.md`
2. `sdk/python/pyproject.toml`
3. `sdk/python/examples/smoke_test.py`

其中 `sdk/python/README.md` 现在只保留入口壳；这里仍是当前仓库里唯一明确作为 Python distribution package 验证 `python -m build` 的目录。