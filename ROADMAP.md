# A2A-Pay ROADMAP

> Last updated: 2026-03-09

## 🎯 当前目标
构建一个面向 Agent 高频调用的 A2A 支付系统：
- 控制面：由 Master Wallet 管理 Agent 与 Service。
- 数据面：高频调用走轻量鉴权与稳定支付链路。
- 配置面：Service 配置以后端为唯一事实来源（single source of truth）。

---

## ✅ 已完成（Done）

### 1) 合约与链路基础
- 已完成核心合约与本地测试链路：
  - `A2APaySyncRouter`
  - `MockUSDC`
- Hardhat 测试通过（当前 1/1，保留主链路用例）。

### 2) Service 数据源统一（关键里程碑）
- 已将 Service 配置从前端本地存储迁移为后端 API 主导。
- 前端 Service 页面（列表/新增/编辑/删除）改为调用后端：
  - list / create / update / delete。
- 后端服务模型补齐 `agentId` 字段并完成持久化支持。
- 删除前端旧 `serviceStore`（避免本地与后端双写不一致）。

### 3) Dashboard 与详情页联动
- Dashboard 服务视图改为读取后端 Service Registry。
- Service 详情页改为读取后端数据源。
- 按 `ownerAddress` 维度进行数据隔离读取。

### 4) Services 页面交互升级
- 新增/编辑从内联表单改为弹窗交互。
- 删除改为显式按钮 + 自定义确认弹窗（不再使用浏览器原生 `confirm()`）。
- 弹窗视觉优化已完成：
  - 宽度与留白提升；
  - 两列表单布局；
  - 操作区层级与按钮触达优化。
- 前端 lint 与生产构建通过。

### 5) 文档口径统一
- 已清理文档中对 `serviceStore` 的旧描述。
- 统一为“Service 配置以后端为唯一口径”。

---

## 🚧 进行中（In Progress）

### 鉴权流程收敛（Wallet-first）
当前 Dashboard 流程为：
1. `ClientGuard`（本地 developer session 模拟登录）
2. `WalletGuard`（连接钱包）

为了匹配 Agent 高频调用场景，已达成方向共识：
- “账号注册/密码登录”不应成为主链路必经步骤。
- 未来应迁移为 **钱包即身份** 的 wallet-first 模式。

---

## 🧭 下一步计划（Next）

### P0（优先级最高）
- [x] 将 Dashboard 守卫顺序调整为钱包优先（或合并为单一 WalletAuthGuard）。
- [x] 引入“钱包签名登录 + 短期 token”机制（替代本地模拟登录）。
- [x] 后端统一验签与 token 校验中间件，保持 `X-User-Address` 与 token 一致性校验。
- [x] 清理旧版 `ClientGuard` / `WalletGuard` 组件，避免后续误用旧鉴权流程。

### P1（高频调用可用性）
- [x] 为 Agent 调用增加短期凭证（可撤销、可过期、可限额）。
- [x] 增加限流与配额策略（按 owner / agent / service 维度）。
- [x] 增加关键操作审计日志（创建服务、更新路由、额度变化、删除服务）。

### P2（可运维与可观测）
- [ ] 增加端到端验收脚本（前端操作 + 后端数据校验 + 合约交易回执）。
- [ ] 增加基础监控指标（请求成功率、P95、支付成功率、失败分类）。
- [ ] 补充部署与回滚 SOP 文档。

---

## 📌 当前结论
- 代码主链路已基本跑通（前端 build/lint 通过，合约测试通过）。
- 当前最大架构待办是将“模拟账号登录”升级为“钱包签名鉴权”。
- 完成 wallet-first 改造后，系统将更贴合 Agent 高频调用场景。
