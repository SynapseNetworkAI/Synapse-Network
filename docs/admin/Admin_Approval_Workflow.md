# 管理后台审批流设计

- Status: canonical
- Code paths: `admin/gateway-admin/src/`, `admin/admin-front/src/`
- DB sources: admin approval tables, admin projection views, `docker-compose/postgres/init/gateway/001_synapse_schema.sql`
- Supersedes: root `docs/充值退款审批流程.md` for control-plane approval semantics
- Last verified against code: 2026-03-24

本文定义平台管理后台中高风险动作的审批模型、状态机、执行边界和与 `gateway` 的交互方式。

当前充值补偿、退款审批、提现审核等控制面语义，以本文件为 canonical 入口。former root `docs/充值退款审批流程.md` 已完成退役。

目标是保证：

- 单人不能完成高危资金动作闭环
- 所有高风险操作都有审批号和审计链
- 审批系统是控制面，而不是直接篡改交易真相

## 1. 为什么必须有审批流

以下动作一旦误操作，会直接影响资金安全或平台治理安全：

- 手工补账
- 手工改余额
- 提现放行
- 大额退款放行
- 手工冻结 / 解冻资金
- 平台费率修改
- 风控阈值修改
- 高风险白名单放行
- 管理员提权

这些动作都不应当由一个后台按钮“点击即生效”。

审批流的本质是：

- 把命令提交与命令执行拆开
- 把业务判断与资金生效拆开
- 把人和责任链固化下来

## 2. 审批流总体模型

建议采用三层结构：

### 2.1 Request 层

由发起人提交申请，生成审批单。

包含：

- 申请类型
- 目标资源
- 原因说明
- 影响金额
- 关联用户 / 钱包 / txHash
- 风险等级
- 建议执行动作

### 2.2 Approval 层

由审核角色完成审批。

特点：

- 审批人与发起人分离
- 高等级动作支持多级审批
- 审批结论必须带理由

### 2.3 Execution 层

审批通过后，由执行器执行最终命令。

执行器可以是：

- `gateway-admin` 内部受控 service
- `gateway` 内部管理接口
- 异步 worker / job runner

执行层不能绕过审批层直接操作资金主表。

## 3. 适用审批动作清单

建议第一期纳入审批流的动作：

1. `deposit_repair`
2. `balance_manual_adjust`
3. `withdrawal_approve`
4. `refund_approve`
5. `freeze_account`
6. `unfreeze_account`
7. `fee_policy_change`
8. `risk_rule_change`
9. `risk_whitelist_change`
10. `admin_role_grant`

## 4. 审批单模型

建议后台后端定义统一审批单实体，例如：

- `approval_id`
- `approval_type`
- `approval_level`
- `status`
- `requester_id`
- `current_approver_id`
- `resource_type`
- `resource_id`
- `payload_json`
- `risk_level`
- `amount_usdc`
- `reason`
- `created_at`
- `updated_at`
- `approved_at`
- `executed_at`
- `rejected_at`
- `execution_result`

其中 `payload_json` 用来保存具体业务参数，例如：

- 补账金额
- owner address
- txHash
- 回拨原因
- 配置变更前后值

## 5. 审批状态机

建议审批单采用下面状态机。

### 5.1 状态定义

- `DRAFT`
- `SUBMITTED`
- `UNDER_REVIEW`
- `APPROVED_PENDING_EXECUTION`
- `EXECUTING`
- `EXECUTED`
- `REJECTED`
- `CANCELLED`
- `FAILED`
- `EXPIRED`

### 5.2 状态说明

`DRAFT`
说明：发起人尚未正式提交。

`SUBMITTED`
说明：审批单已提交，等待分派或进入审核。

`UNDER_REVIEW`
说明：审批人已接单审核中。

`APPROVED_PENDING_EXECUTION`
说明：审批通过，但尚未执行命令。

`EXECUTING`
说明：命令正在执行。

`EXECUTED`
说明：命令执行成功，闭环完成。

`REJECTED`
说明：审批不通过。

`CANCELLED`
说明：发起人或系统取消。

`FAILED`
说明：审批已通过，但执行失败，需要人工处理。

`EXPIRED`
说明：长时间未处理或审批超时。

### 5.3 推荐状态流转

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED_PENDING_EXECUTION -> EXECUTING -> EXECUTED
                             \-> REJECTED
SUBMITTED -> CANCELLED
UNDER_REVIEW -> CANCELLED
APPROVED_PENDING_EXECUTION -> FAILED
APPROVED_PENDING_EXECUTION -> EXPIRED
```

## 6. 不同动作的审批级别

### 6.1 L1 低风险

适用：

- 普通工单流转
- 非生产环境配置变更

要求：

- 单审批人

### 6.2 L2 中风险

适用：

- 小额补账
- 小额退款放行
- 普通冻结申请

要求：

- 发起人与审批人分离

### 6.3 L3 高风险

适用：

- 中大额补账
- 提现放行
- 风控规则生产修改
- 白名单变更

要求：

- 至少一级审批
- 审批理由必填
- 执行结果强审计

### 6.4 L4 极高风险

适用：

- 大额手工余额调整
- 超大额补账
- 管理员高权限授予
- 核心平台费率变更

要求：

- 两级审批
- 发起人、审批人、执行人至少两两分离
- 可选冷静期或超管复核

## 7. 关键动作审批流示例

### 7.1 手工补账审批流

适用场景：用户链上已充值，但平台账本未到账。

流程：

1. 财务管理员发起 `deposit_repair` 申请
2. 系统自动附带：
   - owner
   - txHash
   - eventKey
   - 链上金额
   - 当前 intent 状态
   - 当前余额快照
3. 审批人审核证据
4. 审批通过后进入执行队列
5. 执行器调用受控 repair / replay 命令
6. 成功后写回执行结果和审计日志

注意：

- 不允许前端直接执行补账 SQL
- 不允许审批通过后由浏览器直接改主库

### 7.2 提现审批流

流程：

1. 财务管理员或系统提交提现待审单
2. 风控系统附带风险评分
3. 财务审核员审批
4. 审批通过后由执行器完成链上签名/放行或内部状态迁移
5. 写回结果与 txHash

### 7.3 风控白名单审批流

流程：

1. 风控管理员发起白名单放行申请
2. 风控复核人审批
3. 变更生效并写审计
4. 自动通知相关观察规则

### 7.4 平台费率变更审批流

流程：

1. 运营或平台管理员提交费率变更申请
2. 系统展示 before / after diff
3. 审批通过后写入配置中心
4. 记录生效时间、变更版本、回滚信息

## 8. 审批人与执行人分离规则

建议强制执行以下 SoD 规则：

1. 发起人不能审批自己的单
2. 审批人不能执行自己的高危审批单
3. 高等级审批单不能由同一角色组全部闭环
4. 超管也不应该绕过审计直接生效

如果必须走紧急通道，也要：

- 记录 emergency 标记
- 记录紧急原因
- 自动推送事后复盘

## 9. 审批流与 `gateway` 的边界

这里是最关键的架构边界。

### 9.1 审批系统不直接拥有交易真相

审批流只是控制面，不应该直接成为账本真相来源。

例如：

- 审批系统可以批准“允许执行补账”
- 但真正的余额变更仍应由 `gateway` 受控逻辑完成

### 9.2 推荐执行方式

审批通过后，执行器应调用：

- `gateway` 的内部受控命令接口
- 或 `gateway-admin` 中封装的受限 adapter

而不是：

- 后台前端直连数据库
- 审批服务绕过业务校验直接写余额表

### 9.3 执行前再次校验

审批通过不代表执行时一定还合法。执行前应再次校验：

- 审批单是否仍有效
- 资源状态是否变化
- 该笔资金是否已被其他流程处理
- 是否满足幂等条件

## 10. 审批失败与补偿

如果审批已经通过但执行失败，应进入 `FAILED`，并保留：

- 错误码
- 错误信息
- 执行堆栈摘要
- 可否重试
- 下一个处理人

建议支持：

- `retry execution`
- `force cancel`
- `escalate`

但这些动作本身也应进入审计。

## 11. 前端交互建议

审批流前端不应只是一个列表页，而应包含：

- 待我审批
- 我发起的
- 已执行
- 已拒绝
- 执行失败待处理

每条审批单应展示：

- 申请类型
- 目标对象
- 风险等级
- 影响金额
- 发起人
- 当前审批级别
- 审批历史
- 执行结果

高风险单应显示明显风险提示，不允许“一键通过”。

## 12. 审计要求

审批流必须记录两类日志。

### 12.1 审批行为日志

- 提交审批单
- 指派审批人
- 审批通过
- 审批拒绝
- 审批撤销
- 审批升级

### 12.2 执行行为日志

- 开始执行
- 执行成功
- 执行失败
- 重试执行
- 回滚或补偿

## 13. 第一阶段推荐落地范围

建议先实现这四类审批流：

1. `deposit_repair`
2. `withdrawal_approve`
3. `refund_approve`
4. `fee_policy_change`

这是最能体现资金安全和治理边界的最小闭环。

## 14. 最终建议

1. 审批流必须独立成后台控制面核心能力，而不是零散按钮确认框。
2. 审批系统批准的是“命令执行权”，不是“直接改主账本”。
3. 高危资金动作必须强制 SoD，不允许发起、审批、执行同人闭环。
4. 所有审批流都要具备状态机、审计链、失败补偿和幂等控制。
5. 第一阶段优先覆盖补账、提现、退款、费率变更四类审批流。
