# Admin Control Plane Architecture

## 1. 目标

Admin Control Plane 不是 Gateway Console 的隐藏页面，而是独立的治理和风控系统。

它存在的原因很简单：

1. 交易面追求高频与低延迟
2. 管理面追求强审计、强权限和强审批

这两者不能再混在一个应用心智里。

## 2. 服务对象

Admin Control Plane 服务的是平台内部管理员，不是普通 Owner。

典型角色包括：

1. platform admin
2. finance admin
3. risk reviewer
4. compliance / audit reader
5. operations admin

## 3. 核心模块

### 3.1 Risk Center

负责：

1. deposit 异常监控
2. invocation 异常监控
3. withdrawal 风险分流
4. liquidity 告警

### 3.2 Approval Center

负责：

1. yellow-risk withdrawal review
2. refund review
3. fee policy review
4. high-risk manual actions

### 3.3 Finance and Reconciliation

负责：

1. vault obligation 对账
2. deposit replay
3. settlement tracing
4. provider payout investigation

### 3.4 Governance and Access

负责：

1. admin RBAC
2. session and MFA
3. audit trail export
4. system configuration governance

## 4. 结构原则

Admin Control Plane 必须满足：

1. 前后端独立部署
2. 管理员身份和普通 owner 身份隔离
3. 高风险动作要求审批或双人分离
4. 不允许后台页面直接篡改交易主真相表

当前仓库实现约束：

1. 用户控制台前端在 `apps/frontend`。
2. Admin Control Plane 前端应在 `admin/admin-front`。
3. Admin Control Plane 后端应在 `admin/gateway-admin`。
4. 不要再把管理员工作流塞回 `apps/frontend/src/app/dashboard/*`。

## 5. 页面分层

### 5.1 Admin Overview

只放全局状态：

1. liquidity status
2. pending approvals
3. deposit reconciliation backlog
4. abnormal invocation spikes
5. withdrawal risk queue

首页卡片边界进一步收敛为：

1. `Control plane status`
2. `Deposit absolute delta`
3. `Treasury absolute delta`
4. `Pending approvals`
5. `Today deposit / charge / refund / withdrawal`
6. `Pending deposits / pending withdrawals / deposit exceptions / audit alerts`
7. `Deposit / Billing / Outflow` 三个缩略漏斗摘要

Admin Overview 不放：

1. 逐笔充值表
2. 逐笔 audit 明细
3. replay / repair 执行按钮

### 5.2 Queue-driven Workspaces

Admin 的主工作界面不是“看一个总表”，而是按工作队列组织：

1. approvals queue
2. withdrawals review queue
3. reconciliation queue
4. admin audit queue

其中 finance 相关页面应固定分成：

1. `/finance`
	只看 Treasury 总账、流量趋势、出入金压力。
2. `/finance/reconciliation`
	只看 `Chain vault / Ledger obligation / Signed difference / Absolute delta`、补偿队列和证据列表。

换句话说：

1. Finance 是“总账判断页”
2. Reconciliation 是“事故调查页”

### 5.3 Record Detail Page

每一个高风险动作都应该有 detail page，展示：

1. who requested
2. why it matters
3. what financial objects are touched
4. what evidence is attached
5. what final decision was made

对于 Finance / Reconciliation 相关 detail，还必须补充：

1. 哪个 bucket 被影响
2. 当前是 owner liability、provider payable 还是 platform income 口径
3. 是否存在 deposit repair / refund / withdrawal 的关联动作

## 6. 和 Gateway Console 的边界

Gateway Console 做：

1. Owner 授权
2. Agent 管理
3. Provider 服务管理
4. 自助收益与提现

Admin Control Plane 做：

1. 风控拦截
2. 人工审核
3. 对账和异常调查
4. 管理员权限治理

两者的边界非常硬：

1. Owner 不应该看到 admin workflow
2. 管理员不应该通过普通控制台路径做资金高危操作

## 7. 审批与执行原则

管理后台必须遵守：

1. request 层和 execution 层分离
2. 审批不能等于直接改库
3. 所有高危动作必须有独立 approval record 和 audit record

这意味着后台页面最多发起“受控命令”，真正执行仍然由后端受控服务完成。

## 8. 文档结论

Admin Control Plane 是平台治理系统，不是普通控制台的一个 tab。

它的目标是让平台在资金、风控、合规和审批层面具备生产级治理能力，而不是给管理员多开几个表格页面。