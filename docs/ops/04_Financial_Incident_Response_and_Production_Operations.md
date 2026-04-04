# Financial Incident Response and Production Operations

## 1. 目标

本文件定义 Synapse 在金融异常、重放攻击、幂等冲突、退款异常、提现风控异常场景中的生产响应纪律。

核心原则只有一句话：

**当交付速度与资金安全冲突时，永远选择资金安全。**

## 2. 事件类型

重点覆盖：

1. financial API abuse
2. replay attack
3. idempotency conflict
4. abnormal refund behavior
5. withdrawal risk spike
6. reconciliation mismatch

## 3. 告警基线

以下信号应触发高优先级响应：

1. 同一 owner 或 action 的写路径限流短时间异常升高
2. deposit replay 事件短时间激增
3. 同一 idempotency key 对不同 payload 的冲突激增
4. refund intent 创建量明显偏离基线
5. Redis 幂等 claim 冲突显著上升

## 4. Triage 清单

接警后应优先确认：

1. 受影响 owner、endpoint、action type
2. 单源异常还是分布式异常
3. 是客户端重试 bug 还是恶意重放
4. Redis 健康和延迟是否异常
5. request_id / trace_id 在审计和活动日志中是否能串起来

## 5. 立即止损动作

### 5.1 写路径止损

优先动作包括：

1. 降低金融写接口限流阈值
2. 封禁恶意 token 或 session
3. 必要时做 WAF / IP block

### 5.2 运行模式调整

如果 Redis 或分布式控制层异常，应进入降级模式并提高后端监控频率。

### 5.3 资金高危动作冻结

当提现、退款或入金确认链路存在系统性异常时，应优先：

1. 冻结高危自动放行
2. 切到人工审核
3. 保留完整审计证据链

## 6. 调查与恢复

恢复动作至少包括：

1. 导出审计日志和使用日志
2. 核验受影响 owner 的 ledger 一致性
3. 对部分失败 intent、deposit、withdrawal 做状态归并
4. 发布事件摘要和根因

## 7. 生产操作纪律

### 7.1 不允许直接改真相表掩盖问题

生产修复必须优先通过：

1. replay
2. reconciliation
3. approval-driven controlled command

### 7.2 高危动作必须审批化

以下动作应经过审批或双人分离：

1. 大额提现放行
2. 资金纠偏
3. 费率策略高影响修改
4. 生产紧急配置变更

### 7.3 事后必须回到测试和监控

每次事故处理后至少要补：

1. 回归测试
2. 监控面板
3. 告警阈值校准
4. 文档更新

## 8. Ownership

建议最小值班和沟通结构：

1. Primary owner: backend platform on-call
2. Secondary owner: security engineering
3. Communication: incident bridge + status page

## 9. 文档结论

Synapse 的生产运维不是“服务活着就行”，而是：

**异常可发现、资金可止损、修复可审计、恢复可验证。**