# Phase 8: Indexer API与前端重构 (Indexer API & Frontend Refactoring)

## 📌 目标 (Goal)
为了解决直接使用前端轮询或全量查询 RPC 节点带来的性能瓶颈、网络开销和卡顿问题，我们将区块链查询的工作移交给后端的 Python Indexer 统一处理。前端重构为调用 Indexer 的 Restful API。

## 🎯 核心架构拆解 (Core Architecture)

### 1. **Persistent Blockchain Indexer (Python SDK + FastAPI)**
取代传统的 `last_block = current_block - 1000` 做法：
- **物理数据库持久化 (SQLite + SQLAlchemy)**: 引进物理文件 `indexer.db` 代替 `:memory:`，解决多线程环境下的游标丢失以及状态重置问题。
- **持久化同步游标 (`SyncState` 模型)**: 在表内记录最新的 `last_block`。即使 Indexer 进程被强杀 (被 `kill -9` 或断电宕机)，重新启动时，也能完全从上一次失败的区块开始监听 (Resume from last block)。
- **Transaction Rollback (事务回滚机制)**: Indexer 在处理最新的区块事件时，会同时进行区块状态 `SyncState` 和任务 `TaskModel` 的更新；只要中间发生任何意外导致数据库写入失败，都会执行 `db.rollback()`，保证数据状态的一致性，防止数据发生撕裂或者只存储一半。

### 2. **RESTful API Endpoint**
- Indexer 透出 `/api/tasks` GET 接口，通过 FastAPI 的 `CORSMiddleware` 授权前端的安全跨域拉取机制；
- **Pydantic 解析稳定化**: 将 SQLAlchemy 查询出来的记录转为标准的 Dict 给到前端，解决了 ORM 模式下的类型和验证错误，使得 API 数据返回更加稳定。

### 3. **前端 (Next.js) 面板的改造**
- **移除重负载的 RPC 历史查询**: 删除使用 `ethers` 从创世区块 `0` 开始抓取日志的历史逻辑 (`contract.queryFilter`)。
- **切换到 HTTP 数据源**: 使用常规的 `fetch("http://127.0.0.1:8000/api/tasks")`，把查询大区块日志转变为直接获取已经格式化好的本地数据库历史列表。
- **解决 BigInt 渲染问题**: 在以太坊智能合约接收实时 Event 时，Task ID 被解析成了 `BigInt`。在 React 框架下，直接把 state 设置为 `BigInt` 极易引发 React Serialized Render Error。通过强转为字符串 `taskId.toString()` 获取绝对稳定性。
- **保留 Web3 的闪电热更新**: 历史数据由 Indexer REST API 秒出，实时事件则通过 WebSockets (`contract.on`) 持续叠加到 React UI 顶部，实现“历史查询零负担，实时事件秒上屏”的双混合查询机制。

---

## 🚀 该特性的最终业务收益
1. **防止 RPC 被封禁**: 在商用环境下，不再依赖前端用户的高频调用和并发请求，极大减轻 RPC 的压力。
2. **Crash-Safe 完美宕机恢复**: Agent 和 Indexer 可以随意崩溃停止并重新拉起。由于 `SyncState` 这个“数据库游标”的存在，重启时从不遗漏一笔链上款项的对账，对账机制 100% 可靠。
3. **极速的首屏加载性能**: 后端直接以极小的体积瞬间下发 JSON (几毫秒)，代替以太坊全节点历史遍历（几秒到几十秒），真正实现可投产商用的性能感受。