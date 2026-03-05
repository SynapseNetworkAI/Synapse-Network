# Phase 16: 后端 Modular Monolith 环境隔离与多会话设计

## 1. 架构选型与背景 (Modular Monolith)

在构建 A2A-Pay 的后端服务时，我们面临着一个核心的安全挑战：**如何防止客户端 API (Client/Developer API) 与系统管理员 API (Admin API) 发生越权访问？**

如果两者全部混合在一个 FastAPI 实例中，并且操作同一个底层的 SQLite/Postgres DB 连接池：
- **安全风险**：由于 Python 的反射动态性，一旦由于路由不慎疏漏或者 ORM 的联表查询未加限制，一个普通的 Developer 可能查看到全局 `AdminTaskModel` 对应的所有系统抽水数据。
- **复杂度瓶颈**：单体系统的权限中间件会非常臃肿，所有路由必须通过层层 Role-based 过滤。

因此我们采用了 **Modular Monolith (模块化单体)** 设计中的「逻辑与物理隔离方案」。

## 2. 环境与代码层隔离设计 (Environment Isolation)

我们不仅在代码层拆分了文件目录，更在启动进程中进行了端口级的切分：

```text
A2A-pay/python_sdk/indexer/
 ├── admin_api/              (管理员专用的路由模块)
 │    ├── __init__.py
 │    ├── auth.py            (Admin 会话校验)
 │    ├── main.py            (Admin 专属的 uvicorn 入口实例)
 │    └── routes.py          (提供完整的全局任务与收益统计)
 ├── c_api/                  (客户端专用的路由模块)
 │    ├── __init__.py
 │    ├── auth.py            (Client 会话校验)
 │    ├── main.py            (Client 专属的 uvicorn 入口实例)
 │    └── routes.py          (严格过滤仅属于当前 Developer 的链上数据)
 ├── database/               (物理数据连接池隔离)
 │    ├── admin_db.py        (连接 indexer_admin.db)
 │    ├── client_db.py       (连接 indexer_client.db)
 └── models/                 (数据模型隔离)
      ├── admin_models.py
      └── client_models.py
```

### 多进程并行启动 (`run_services.sh`)
通过一个 Bash 调度器 `run_services.sh`，我们在相同一台服务器中同时启动了两个相互平行的微型 FastAPI 服务：
- `127.0.0.1:8000`: 挂载 `indexer.c_api.main:app`
- `127.0.0.1:8001`: 挂载 `indexer.admin_api.main:app`

前端不同角色面板访问不同端口的后端，即使黑客想要嗅探另一角色的路由也是不可能的，因为它们监听在不同的端口，属于进程级别隔离的“微服务化单体”。

## 3. 多会话设计 (Session Design)

配合模块化物理隔离的同时，我们实现了严格的双规制会话设计：

### 3.1 会话颁发与生命周期 (Session Lifecycle)
- **Developer App (Dashboard)**：用户登录后，由校验并写入 `developer_session` 本地态凭证，前端所有 `/api/client/*` 请求默认携带 Bearer dev_session_* Token 且该 Token 只在 `8000` 端口有效。
- **God-Mode Panel (Admin)**：管理员登录后，由验证组件签发 `admin_authenticated` 状态及 2FA Token。前端随后请求 `8001` 端口均带上该管理态会话标识。

### 3.2 退出与销毁机制 (Session Termination)
我们在两套 API 分别增设了各自的销毁终端并实装于 UI：
- `POST /api/client/logout`: 从后端注销 Developer 开发者的登录信令。
- `POST /api/admin/logout`: 从后端注销 Admin 节点管理员的网络认证。

当前端应用主动调用触发登出后，同步清空 LocalStorage 中的认证 Flag（`developer_session` 或 `admin_authenticated`），强制关闭当前登录会话，并切断对应的页面态，跳转回首页 `router.push("/")`。

通过上述多维度的保护与双套独立登出生命周期，A2A-Pay 在不增加部署运维负担的前提下，极其优雅地解决了 Admin 和 C 端安全状态管理与物理隔离混用的架构痛点。
