# 管理后台角色权限矩阵设计

本文定义平台管理后台的角色、权限边界、最小授权原则以及推荐的 RBAC 模型，适用于独立的：

- `admin/admin-front`
- `admin/gateway-admin`

目标是保证：

- 高可用下的权限边界清晰
- 高风险操作必须可审计
- 普通查询权限与资金修改权限彻底分离
- 单人不可完成高危资金动作闭环

## 1. 设计原则

### 1.1 最小权限原则

每个管理员默认只拥有完成本职工作所需的最小权限。

例如：

- 客服只能查用户和工单，不能补账
- 风控只能标记风险和提交处理意见，不能放款
- 财务审核员可以审批出账，但不能修改平台风控规则

### 1.2 查询权与命令权分离

后台权限分成两大类：

- `read:*`：只读查询
- `write:*` / `approve:*` / `execute:*`：写入、审批、执行

如果一个角色同时拥有读取和执行能力，也必须在审计中单独标记。

### 1.3 高危动作双人分离

以下动作不允许同一人既发起又最终执行：

- 手工补账
- 手工改余额
- 提现放行
- 大额退款放行
- 平台费率修改
- 风控白名单变更
- 管理员角色提升

### 1.4 后台权限与网关用户权限隔离

后台权限不继承自：

- 买家身份
- 卖家身份
- 钱包登录身份

后台管理员必须进入独立的 admin 身份体系。

### 1.5 强审计原则

所有带 `write / approve / execute / grant / revoke` 的权限动作必须记录：

- 操作人
- 时间
- 请求来源
- 审批单号
- 资源对象
- 变更前后值
- 执行结果

## 2. 权限模型

建议使用：

- RBAC 作为主模型
- ABAC 作为补充过滤

其中：

- RBAC 决定“你能不能做某类动作”
- ABAC 决定“你能对哪些对象做这类动作”

### 2.1 RBAC 角色层

建议固定以下平台角色：

1. `super_admin`
2. `platform_ops_admin`
3. `finance_admin`
4. `finance_reviewer`
5. `risk_admin`
6. `risk_reviewer`
7. `compliance_auditor`
8. `support_agent`
9. `readonly_analyst`

### 2.2 ABAC 属性层

建议补充以下属性约束：

- 数据敏感级别
- 风险等级
- 金额阈值
- 环境类型（dev/staging/prod）
- 资源所属业务线
- 是否为高危配置

例如：

- `finance_admin` 可以发起补账，但当金额 `>= 5000 USDC` 时必须升级审批级别
- `risk_reviewer` 只能审批自己负责区域的风险工单
- `platform_ops_admin` 在 `prod` 不能直接关闭风控，只能在 `dev/staging` 调试

## 3. 角色定义

### 3.1 `super_admin`

职责：

- 平台级超级管理
- 管理员体系治理
- 最终紧急变更控制

原则：

- 数量极少
- 强制 MFA
- 强制双审计
- 不作为日常操作账号使用

不建议用于：

- 日常审核
- 普通报表查看
- 一线运营处理

### 3.2 `platform_ops_admin`

职责：

- 平台配置维护
- 运行状态查看
- 服务治理
- 告警处理

边界：

- 可改平台配置
- 不可直接补账
- 不可直接审批出账

### 3.3 `finance_admin`

职责：

- 充值异常处理
- 退款与提现工单发起
- 补账申请发起
- 资金运营查询

边界：

- 可发起资金处理单
- 不可单人终审高危资金动作

### 3.4 `finance_reviewer`

职责：

- 审批提现
- 审批大额退款
- 审批手工补账
- 审批余额修复

边界：

- 可审批
- 不负责平台配置治理
- 不负责风控规则配置

### 3.5 `risk_admin`

职责：

- 风险规则维护
- 风险标签维护
- 黑白名单发起变更
- 风控工单处理

边界：

- 可发起风控规则修改
- 不可直接审批高危资金出账

### 3.6 `risk_reviewer`

职责：

- 审批高危账户处置
- 审批高风险白名单放行
- 审批大额可疑行为例外处理

边界：

- 可审批风险处置
- 不直接承担财务补账执行

### 3.7 `compliance_auditor`

职责：

- 查看管理员行为审计
- 查看资金审计
- 查看审批链路
- 导出审计报表

边界：

- 只读
- 不可改配置
- 不可发起命令

### 3.8 `support_agent`

职责：

- 查询用户资料
- 查询充值/退款/提现状态
- 创建工单
- 升级异常到财务或风控

边界：

- 只读 + 工单发起
- 不可补账
- 不可审批
- 不可修改平台配置

### 3.9 `readonly_analyst`

职责：

- 查看运营与业务统计数据
- 查看增长与收入报表

边界：

- 纯只读
- 不访问敏感 PII 明细时可进一步脱敏

## 4. 权限资源域

建议将权限按资源域切分。

### 4.1 管理身份域

- `admin_user:read`
- `admin_user:create`
- `admin_user:update`
- `admin_user:disable`
- `admin_role:read`
- `admin_role:grant`
- `admin_role:revoke`

### 4.2 平台配置域

- `platform_config:read`
- `platform_config:update`
- `fee_policy:read`
- `fee_policy:update`
- `service_registry:read`
- `service_registry:update`

### 4.3 资金运营域

- `finance_dashboard:read`
- `deposit:read`
- `deposit:replay_request`
- `deposit:repair_request`
- `refund:read`
- `refund:approve`
- `withdrawal:read`
- `withdrawal:approve`
- `balance:freeze_request`
- `balance:unfreeze_request`
- `balance:manual_adjust_request`

### 4.4 风控域

- `risk_rule:read`
- `risk_rule:update`
- `risk_case:read`
- `risk_case:assign`
- `risk_case:approve`
- `risk_label:update`
- `risk_whitelist:request`
- `risk_whitelist:approve`

### 4.5 审计与合规域

- `audit_finance:read`
- `audit_admin:read`
- `approval:read`
- `approval:export`

### 4.6 系统运维域

- `system_status:read`
- `runtime_state:read`
- `indexer:read`
- `indexer:backfill_request`
- `system_job:read`
- `system_job:trigger`

## 5. 角色权限矩阵

下面给出第一版推荐矩阵。符号定义：

- `R`：只读
- `W`：发起修改/提交申请
- `A`：审批
- `E`：执行
- `-`：无权限

| 资源域 / 角色 | super_admin | platform_ops_admin | finance_admin | finance_reviewer | risk_admin | risk_reviewer | compliance_auditor | support_agent | readonly_analyst |
|---|---|---|---|---|---|---|---|---|---|
| 管理员账号与角色 | A/E | R | - | - | - | - | R | - | - |
| 平台配置 | A/E | W | - | - | - | - | R | - | R |
| 费率配置 | A/E | W | R | - | - | - | R | - | R |
| 服务注册配置 | A/E | W | - | - | - | - | R | - | R |
| 充值查询 | R | R | R | R | R | R | R | R | R |
| 充值 replay / repair 发起 | A/E | - | W | A | - | - | R | - | - |
| 手工补账执行 | A/E | - | W | A | - | - | R | - | - |
| 提现审批 | A/E | - | W | A | - | - | R | - | - |
| 退款审批 | A/E | - | W | A | - | - | R | - | - |
| 冻结 / 解冻申请 | A/E | - | W | A | W | A | R | - | - |
| 风险规则修改 | A/E | - | - | - | W | A | R | - | - |
| 风险标签维护 | A/E | - | - | - | W | A | R | - | - |
| 白名单变更 | A/E | - | - | - | W | A | R | - | - |
| 审计日志查看 | R | R | R | R | R | R | R | 限制只读 | 汇总只读 |
| 报表统计 | R | R | R | R | R | R | R | 限制只读 | R |
| 系统状态查看 | R | R | R | R | R | R | R | 受限 | R |
| 手工触发后台任务 | A/E | W | - | - | - | - | R | - | - |

## 6. 高风险权限额外限制

以下权限除了角色判断，还必须叠加额外条件。

### 6.1 `deposit:repair_request`

要求：

- 工单必填
- 原因必填
- 默认需要二级审批
- 金额超过阈值需要更高级审批

### 6.2 `balance:manual_adjust_request`

要求：

- 默认禁止直接开放给普通角色
- 必须带审批单号
- 必须记录 before / after
- 生产环境必须双人复核

### 6.3 `fee_policy:update`

要求：

- 变更必须记录 diff
- 生产环境强制审批
- 必须具备回滚策略

### 6.4 `admin_role:grant`

要求：

- 超级管理员或专门的 IAM 管理员才可用
- 不允许给自己直接提权并立即生效而无审计

## 7. 推荐审批级别与金额阈值

建议引入审批级别：

- `L1`：低风险，单审批人
- `L2`：中风险，发起人与审批人分离
- `L3`：高风险，双审批人 + 审计抄送
- `L4`：极高风险，双审批 + 超管复核 + 冷静期

推荐：

- `0 ~ 500 USDC` 的补账：`L2`
- `500 ~ 5000 USDC` 的补账：`L3`
- `> 5000 USDC` 的补账：`L4`
- 平台费率修改：至少 `L3`
- 白名单高风险放行：至少 `L3`

## 8. 后台前端落地建议

前端不要只做“菜单隐藏”，而要在页面层显式区分：

- 可见但不可操作
- 完全不可见
- 需要审批才能继续

例如：

- `finance_admin` 看到“手工补账”按钮时，按钮文案应是“提交补账申请”，而不是“立即补账”
- `finance_reviewer` 看到的是“审批补账申请”
- `support_agent` 则完全看不到该入口

## 9. 后台后端落地建议

`gateway-admin` 后端不要只做简单路由鉴权，应该至少实现：

1. `require_permission(permission)`
2. `require_approval_level(level)`
3. `require_resource_scope(scope)`
4. `require_separation_of_duties()`

即使角色相同，也要避免：

- 发起人审批自己的单
- 规则制定人批准自己的例外放行

## 10. 菜单树权限设计

后台导航现在不是平面菜单，而是三类节点组成的树：

- `category`：只负责信息架构分组，本身不代表页面路由。
- `page`：真正可导航的页面节点，必须有 `href`。
- `panel`：页面内二级信息面板，用来把 `overview` 原型里的 dashboard 子视图建模成稳定元数据。

权限规则必须按下面的顺序执行：

1. 先判断 `page` 节点本身的 `requiredRoles / requiredPermissions`。
2. `panel` 节点不单独放大权限面，它只能依附于已可见的父 `page` 返回。
3. `category` 节点只有在自己可见且至少有一个可见子节点时才返回，避免壳子渲染空分组。

推荐约束：

- `control-overview` 分类默认公开给所有后台角色，但它下面的 `dashboard / execution / system` 页面分别按 `dashboard:read`、`execution:read` 控制。
- `identity-access` 下的 `users / role-permissions / menu-config` 只给 `super_admin` 与 `platform_ops_admin`，避免财务和风控角色看到控制面治理入口。
- `business-control` 作为审批与资金域根节点，是否出现由 `approvals / finance / risk / withdrawal-reviews` 这些子页面实际权限决定。
- `panel` 只承担 IA 和搜索，不承载额外 SoD 决策；真正的命令权限仍然落在页面接口和按钮级权限上。

## 11. 最终建议

1. 第一版后台角色建议固定为九类，不要一开始就做无限自定义角色。
2. 所有高危资金动作必须拆成“发起”和“审批/执行”两段权限。
3. `super_admin` 只能作为紧急权限，不做日常操作账号。
4. `gateway-admin` 必须实现 RBAC + 审批流 + 审计三件套，不能只做后台 CRUD。
5. `admin-front` 页面权限要与审批语义一致，避免误导性“立即执行”操作。
