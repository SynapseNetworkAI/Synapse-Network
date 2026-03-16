# 平台管理后台架构设计

本文回答下面几个生产级问题：

- 是否需要新增独立的管理后台前端 `admin/admin-front`
- 是否需要新增独立的管理后台后端 `admin/gateway-admin`
- 是否应该把平台管理后台与平台网关 `gateway` 做代码隔离、文档隔离、权限隔离、数据库隔离
- 管理后台前后端分别应该实现哪些功能
- `gateway/src/domain` 是否应该直接复用
- 项目目录应该怎样重构更合理

结论先行：

**需要新增独立的管理后台前端与后端，并且应该与交易网关做部署隔离、权限隔离、审计隔离；数据库建议至少做“管理域与交易域逻辑隔离”，生产目标应进一步演进到“管理身份/权限库独立、资金账本库独立、分析库独立”。**

## 1. 为什么必须把管理后台和网关隔离

当前 `gateway` 的核心职责是：

- 用户认证与 Agent 调用入口
- 充值、扣费、退款、提现等交易路径
- 资金账本维护
- 运行时索引、风控、对账

如果把“平台管理员界面”和“交易网关”继续混在同一个应用里，生产上会出现四类问题。

### 1.1 暴露面过大

交易网关本来就面向买家、卖家、Agent、SDK、自动化脚本开放。如果管理员接口也挂在同一个应用、同一个入口域名、同一套 token 体系里：

- 攻击面会明显增大
- 权限绕过风险会上升
- 配置修改接口更容易被误暴露

### 1.2 高可用目标冲突

交易网关关注的是：

- 低延迟
- 高并发
- 交易一致性

管理后台关注的是：

- 强审计
- 权限审批
- 大报表查询
- 风控工单流转

二者流量模型不同，资源模型不同，扩缩容策略也不同，不适合继续混布在同一个服务进程里。

### 1.3 权限模型不同

交易用户通常只有：

- 买家
- 卖家
- 服务调用者

而管理后台需要更细的管理角色：

- 平台超级管理员
- 财务管理员
- 风控审核员
- 运营管理员
- 只读审计员
- 客服支持

这些角色不应该与网关用户的普通钱包身份模型直接耦合。

### 1.4 审计要求更高

管理员行为必须满足：

- 谁看了什么
- 谁改了什么配置
- 谁审批了哪一笔出账
- 谁执行了哪一次人工补账

这类系统审计日志应独立于普通业务日志管理，否则后续做合规、追责、回放会非常困难。

## 2. 推荐总体架构

推荐拆成三个主要运行面。

### 2.1 交易面 `gateway/`

继续保留现有 `gateway` 作为交易网关：

- 面向买家/卖家/Agent/API
- 负责资金变更主链路
- 负责充值索引、风控执行、账本一致性、运行时状态

这个服务不直接承载后台页面，也不直接暴露复杂后台管理接口。

### 2.2 管理前端 `admin/admin-front/`

单独的新前端项目，推荐：

- Next.js
- 独立域名，例如 `admin.synapse.network`
- 只面向平台管理员
- 默认接入企业 SSO / MFA / 内网访问策略

### 2.3 管理后端 `admin/gateway-admin/`

单独的新 Python 项目，推荐：

- FastAPI
- 只暴露后台管理 API
- 只对 `admin-front`、内部服务和跳板网络开放
- 与 `gateway` 通过内网 API、消息队列、受限数据库账户交互

## 3. 生产级隔离建议

### 3.1 文档隔离

建议单独放到 `docs/admin/`。这是合理的。

原因：

- 管理域文档和交易域文档关注点不同
- 后续会有角色权限、审批、报表、对账后台、风控后台等一整套文档
- 单独目录方便沉淀 Runbook、权限矩阵、审计规范

### 3.2 代码隔离

建议隔离，目录独立。

推荐：

- `gateway/` 只保留交易网关
- `admin/admin-front/` 只保留管理后台前端
- `admin/gateway-admin/` 只保留管理后台后端

不要把后台页面直接塞回 `apps/frontend`，也不要把后台控制 API 直接塞回 `gateway/src/api/routers/`。

### 3.3 权限隔离

建议完全隔离。

后台权限至少需要：

- 独立登录体系
- 独立 session / token
- 强制 MFA
- 细粒度 RBAC + ABAC
- 关键操作二次确认与双人审批

不要直接复用用户钱包登录态作为后台管理员权限凭证。

### 3.4 数据库隔离

这里不建议简单回答“全隔离”或“完全不隔离”，而是分层设计。

#### 第一层：必须独立的数据库或 schema

管理身份与权限域建议独立：

- `admin_users`
- `admin_roles`
- `admin_role_bindings`
- `admin_sessions`
- `admin_mfa`
- `admin_action_audit`
- `admin_approval_workflows`

这些不应该与普通用户资金表混在一起。

#### 第二层：资金账本主表继续由 gateway 控制

资金主真相仍建议由 `gateway` 控制，包括：

- balances
- deposit intents
- refund intents
- withdrawal intents
- processed events
- runtime state

管理后台不应该直接随意写这些表。

更安全的方式是：

- 后台通过 `gateway-admin` 发起“管理命令”
- 再由受控内部接口或受控 repository 执行
- 所有高风险动作必须写审计和审批单

#### 第三层：统计分析建议单独读库

报表和数据统计不要直接压主交易库。

推荐：

- 从交易库 CDC / ETL 到分析库
- `admin-front` 的 BI / 大盘 / 趋势图走分析库

这样能降低对交易主库的影响。

### 3.5 网络与部署隔离

推荐：

- `gateway` 走公网 API 域名
- `gateway-admin` 只走内网、VPN、Zero Trust、办公网白名单或 Bastion
- `admin-front` 独立域名，且接 WAF / SSO / IP 策略

## 4. 管理后台职责边界

## 4.1 `admin-front` 应该负责什么

`admin-front` 是操作台，不是业务真相层。它应该负责：

- 管理员登录、MFA、会话管理
- 后台导航与工作台
- 配置查看与编辑表单
- 报表与统计可视化
- 风控审核台
- 入账补账工具界面
- 提现/退款审批界面
- 审计日志查询界面
- 系统运行状态与告警中心

不应该在前端直接拼接 SQL，也不应该直接访问交易库。

## 4.2 `gateway-admin` 应该负责什么

`gateway-admin` 是后台控制面 API 和审批编排层，应该负责：

- 管理员认证与鉴权
- RBAC / ABAC 权限检查
- 系统配置管理
- 平台级策略变更
- 风控工单与人工审核流程
- 高风险资金动作审批流
- 管理员操作审计
- 数据聚合查询
- 对 `gateway` 的受控内部调用

它应当是“命令面 + 控制面”，不是新的交易网关。

## 5. 后台前端功能清单

建议第一期就按模块拆清楚。

### 5.1 管理员身份与会话

- 登录页
- SSO 接入
- MFA 绑定与验证
- 会话查看与强制下线
- IP / 设备策略提示

### 5.2 平台概览 Dashboard

- 总交易额
- 当日充值/扣费/退款/提现
- 链上 vault 余额
- 平台账本义务
- reconciliation 差额
- Dashboard 在实现上应拆成 3 个稳定读模型：finance、activity_trend、operations
- `overview` 与 `system-status` 可以保留，但只作为兼容聚合层，不再承担长期主语义
- operations 读模型只能使用已持久化的 runtime state / logs，不能把 indexer 进程内内存态直接暴露给后台前端
- 失败交易数
- 待审核工单数
- 高风险账户数

Dashboard 数据边界要求：

- admin 后台不能长期直接把 gateway 真相表散查后自行拼装 dashboard 语义
- 应由 gateway 提供稳定的只读投影层给后台消费
- 本仓库当前第一版落地对象为 `synapse_admin_dashboard_projection`
- 它口头上常被叫“投影表”，但当前实现是 SQL view；重点是读模型边界，而不是物理上必须是一张表

### 5.3 配置中心

- 平台费率配置
- 风控阈值配置
- 提现自动审核阈值
- 索引器参数查看
- 限流策略
- 服务注册配置

### 5.4 资金运营中心

- 充值记录查询
- 充值 intent 状态查询
- 入账异常定位
- 单笔 replay / repair 操作
- 提现列表与审批
- 退款列表与审批
- 手工冻结/解冻

### 5.5 风控工作台

- 高风险充值列表
- 大额提现审核
- 异常拆单退款识别
- 黑白名单维护
- 风险标签查看与处置

### 5.6 审计与合规

- 管理员操作审计日志
- 资金变更审计日志
- 审批记录查询
- 导出报表

### 5.7 系统运维中心

- gateway 健康状态
- deposit indexer 状态
- backfill 状态
- reconciliation 状态
- 告警列表
- 运行时参数快照

## 6. 后台后端功能清单

`admin/gateway-admin` 建议至少包含这些模块。

### 6.1 `api/routers/admin_auth.py`

- 登录
- 登出
- MFA challenge
- 刷新 token
- 当前管理员信息

### 6.2 `api/routers/admin_users.py`

- 管理员账号管理
- 角色绑定
- 权限组管理
- 会话封禁

### 6.3 `api/routers/admin_dashboard.py`

- 总览指标
- 趋势图数据
- gateway 只读投影查询
- 告警聚合

### 6.4 `api/routers/admin_finance.py`

- 充值查询
- replay / repair
- 提现审批
- 退款审批
- 账户冻结/解冻

### 6.5 `api/routers/admin_risk.py`

- 风险规则查看
- 风险策略修改
- 风险工单流转
- 账户风险标签处理

### 6.6 `api/routers/admin_system.py`

- gateway 运行状态
- indexer 状态
- runtime state 查询
- 配置中心

### 6.7 `api/routers/admin_audit.py`

- 管理员操作日志
- 审批日志
- 资金审计搜索

### 6.8 `services/approval/`

- 双人审批流程
- 审批状态流转
- 审批前权限校验
- 审批后命令投递

### 6.9 `services/adapters/gateway_client.py`

- 调用 `gateway` 内部受控 API
- 例如单笔 replay、读取 indexer 状态、只读查询资金数据

### 6.10 `storage/`

- 管理员身份库
- 角色权限库
- 管理员审计库
- 审批单库
- 统计查询适配层

## 7. 高风险动作的安全设计

生产级后台最重要的不是页面，而是高风险动作的防误操作机制。

### 7.1 必须做双人审批的动作

建议以下动作要求四眼原则：

- 手工补账
- 手工改余额
- 手工释放冻结资金
- 提现人工通过
- 修改平台费率
- 修改风控阈值
- 修改 whitelist / blacklist

### 7.2 命令与查询分离

后台后端建议采用 CQRS 风格：

- Query：只读报表、查询、统计
- Command：补账、审批、冻结、解冻、配置修改

Command 必须：

- 有审批单号
- 有操作人
- 有复核人
- 有审计记录
- 有幂等键

### 7.3 管理员审计日志独立

管理员行为不能只写普通业务日志。至少要单独记录：

- operator
- role
- action
- resource type
- resource id
- request id
- trace id
- before / after
- approval id
- result

## 8. `gateway/src/domain` 是否应该复用

这里的建议是：

**不要把 `gateway/src/domain` 直接作为 `gateway-admin` 的共享内部包强依赖。可以“概念复用、协议复用、部分 schema 复用”，但不要“源码硬耦合复用”。**

原因有四个。

### 8.1 `gateway` domain 是交易域，不是管理域

当前 `gateway/src/domain` 主要是：

- finance
- auth
- audit
- registry
- system

这些模型服务的是交易网关运行逻辑。后台管理域还需要新的模型：

- admin user
- admin role
- admin permission
- admin approval workflow
- admin action audit
- admin dashboard projection

所以管理后台一定会新增自己的 domain。

### 8.2 如果直接源码复用，会把两个服务绑死

一旦 `gateway-admin` 直接 import `gateway/src/domain`：

- 版本升级会互相卡住
- 网关 domain 变更会波及后台
- 后台需求容易反向污染交易域模型

这对长期演进不利。

### 8.3 可以复用“共享契约”，但不要复用整个交易实现

更合理的做法是把真正稳定的共享部分抽成单独包，例如将来演进为：

- `packages/contracts-python/`
- 或 `sdk/python/synapse_contracts/`

只放：

- 枚举
- DTO
- API schema
- 事件 schema
- 公共错误码

不要把交易 repository、业务 service、内部 domain 全部共享出去。

### 8.4 推荐策略

推荐：

- `gateway-admin` 自己实现自己的 `domain/`
- 对接 `gateway` 时通过内部 API / DTO / event schema 对齐
- 真正跨服务稳定的部分，后续再抽公共 `contracts` 包

## 9. 推荐目录重构

建议逐步演进到下面结构。

```text
Synapse-Network/
  apps/
    frontend/
  gateway/
    src/
      api/
      core/
      daemon/
      domain/
      services/
      storage/
  admin/
    admin-front/
      package.json
      src/
        app/
        components/
        features/
        services/
        hooks/
        lib/
    gateway-admin/
      requirements.txt
      src/
        api/
          routers/
        core/
        domain/
          admin_auth.py
          admin_audit.py
          admin_approval.py
          admin_dashboard.py
          admin_finance.py
          admin_risk.py
        services/
          approval/
          adapters/
          finance_admin/
          risk_admin/
          dashboard/
        storage/
          admin_identity/
          admin_audit/
          admin_approval/
          analytics/
        app.py
  docs/
    admin/
      README.md
      Platform_Admin_Backoffice_Architecture.md
      Admin_RBAC_Design.md
      Admin_Approval_Workflow.md
      Admin_Audit_and_Compliance.md
      Admin_Finance_Operations_Runbook.md
```

## 10. 后台与网关的数据交互方式

建议分三层。

### 10.1 只读查询

后台查询优先走：

- analytics 库
- read replica
- 内部只读 API

不要把 BI 查询直接打到交易主库。

### 10.2 管理命令

后台执行高风险操作时：

- 先创建审批单
- 审批通过后生成 command
- command 再调用 `gateway` 受控接口或内部 service adapter

### 10.3 非同步操作

对于报表刷新、批量补账、批量风控扫描，建议异步化：

- task queue
- job table
- worker

这样不会阻塞后台请求。

## 11. 第一阶段建议落地范围

你现在说“第一步先给出文档，放入 `docs/admin`”，这是对的。

建议第一阶段先不急着建完整后台代码，而是先把下面文档定下来：

1. 平台管理后台总体架构
2. 后台角色权限矩阵
3. 财务审核与补账审批流程
4. 后台审计日志规范
5. 后台与 gateway 的接口边界

本文就是第一份总设计文档。

## 12. 最终建议

最终建议如下：

1. 新增 `docs/admin/`，单独维护后台设计文档，这是正确方向。
2. 新增独立前端 `admin/admin-front/`，不要继续塞进当前用户前端。
3. 新增独立后端 `admin/gateway-admin/`，不要把后台控制 API 继续堆进 `gateway`。
4. 管理后台与交易网关必须做权限隔离、部署隔离、审计隔离。
5. 数据库至少做逻辑隔离；长期目标是管理身份库、交易账本库、分析库分层隔离。
6. `gateway/src/domain` 不建议直接强耦合复用；后台应有自己的 `domain`，只共享稳定契约。
7. 高风险动作必须引入审批流、双人复核、独立审计。
