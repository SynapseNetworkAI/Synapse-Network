# Python SDK / Seller API 维护说明

本文档说明 `python_sdk` 下 Seller FastAPI 的模块化结构、请求链路与扩展建议。

## 目录结构

- `seller_fastapi.py`
  - 薄入口文件，仅负责暴露 `app` 与本地 `uvicorn` 启动。
- `seller_api/app.py`
  - 路由层（FastAPI endpoint 定义）。
  - 负责把请求编排到鉴权、支付、凭证、持久化等能力模块。
- `seller_api/settings.py`
  - 所有环境变量与常量配置。
- `seller_api/state.py`
  - 进程内共享状态（`w3`、锁、限流窗口、挑战 nonce 缓存等）。
- `seller_api/models.py`
  - Pydantic 请求模型。
- `seller_api/common.py`
  - 通用纯函数（如 serviceId/wallet 规范化、pending 响应封装）。
- `seller_api/auth.py`
  - 钱包签名挑战、token 签发/验证、`require_auth` 依赖与 owner 权限校验。
- `seller_api/payment.py`
  - 链上支付校验（收据查询、确认数检查、事件匹配、重放防护）。
- `seller_api/credentials.py`
  - Agent 凭证、配额消费、限流治理（owner/agent/service）。
- `seller_api/persistence.py`
  - 文件持久化读写（service registry / credential / audit logs）。

## 请求链路（核心）

### 1) 控制面（服务管理）

`/api/v1/services/*`

1. `app.py` 接收请求。
2. `auth.require_auth` 完成 token + `X-User-Address` 一致性校验。
3. `credentials.enforce_rate_limit("owner", ...)` 做 owner 维度限流。
4. `persistence` 执行持久化。
5. `persistence.append_audit_log` 写审计。

### 2) 数据面（Paid Generate）

`/api/v1/generate`

1. 校验 `serviceId`（header/body 一致性）。
2. 如传入 `X-Agent-Credential`：
   - `credentials.find_active_credential_or_unauthorized` 校验凭证。
   - `credentials.enforce_generate_rate_limits` 执行三维限流。
3. `payment.verify_payment` 校验链上支付事实。
4. 成功后 `credentials.consume_credential_call` 消费调用额度。
5. 返回业务结果。

## 扩展建议

- 新增路由时，优先只在 `app.py` 放“编排逻辑”，不要下沉业务细节。
- 纯逻辑优先放 `common.py` / `credentials.py` / `payment.py`，避免路由膨胀。
- 新配置必须统一进入 `settings.py`，避免散落 `os.getenv`。
- 共享可变状态统一放 `state.py`，并通过 `lock` 保护并发写路径。
- 新增持久化介质（DB/Redis）时，建议仅替换 `persistence.py` 接口实现，保持路由层不变。

## 本地运行

在 `python_sdk` 目录下：

- 启动开发服务：`python seller_fastapi.py`
- 或使用项目脚本：`./test/setup_local_env.sh`

## 关键兼容点

- 保持原入口导入方式不变：`from seller_fastapi import app`
- 保持 API 路径不变：`/api/v1/*`
- 前端依赖的鉴权/凭证头不变：
  - `Authorization: Bearer <token>`
  - `X-User-Address`
  - `X-Agent-Credential`（可选/可强制）
