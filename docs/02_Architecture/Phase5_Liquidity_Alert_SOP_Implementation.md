# Synapse Phase 5 实施文档：金库流动性风控 + 告警/人工审核 SOP

## 1. 文档定位

本文件是 [Gateway_Financial_Risk_Control_Design.md](./Gateway_Financial_Risk_Control_Design.md) 第 9 章与第 11 章的工程化落地稿，目标是把“策略描述”升级为“可上线实现”。

适用范围：
1. 网关后端（FastAPI + PostgreSQL + Redis）
2. 运维告警链路（Feishu/Telegram/PagerDuty）
3. 人工审核台账与审批动作闭环

不在本次范围：
1. 机器学习模型评分（本阶段保持规则引擎）
2. 合规系统对接的法务流程细节

---

## 2. 目标与非目标

### 2.1 目标

1. 在提现决策前引入实时流动性闸门，防止 Bank Run。
2. 对 P1/P2/P3 风险事件形成统一告警协议和可靠送达。
3. 建立人工审核 SOP 的系统化闭环：入队、领取、审核、复核、审计。
4. 保证“资金一致性优先”，所有风险决策可追踪、可复盘、可回放。

### 2.2 非目标

1. 不改变现有充值/扣费/退款主流程的事务模型。
2. 不新增链上合约逻辑（保持 Dumb Vault 原则）。

---

## 3. 总体架构

## 3.1 组件

1. `LiquidityGuardService`
   - 职责：计算流动性指标、输出 `GREEN/YELLOW/RED` 决策。
2. `RiskDecisionOrchestrator`
   - 职责：合并“提现三段阀门 + 流动性阀门 + 地址风险标签”，给出最终执行动作。
3. `RiskAlertService`
   - 职责：事件归一化、去重、升级、分发到告警渠道。
4. `ManualReviewService`
   - 职责：审核任务入队、领取、审批、驳回、升级、超时处理。
5. `RiskAuditRepository`
   - 职责：Append-only 审计写入，支持按 request_id / owner / 时间窗口检索。

## 3.2 关键数据流

1. 卖家发起提现。
2. 网关进入事务前先调用 `RiskDecisionOrchestrator`。
3. 编排器先走提现风险规则，再走流动性规则。
4. 决策结果：
   - `GREEN`: 自动签发。
   - `YELLOW`: 进入人工审核队列。
   - `RED`: 直接拒绝并触发 P1。
5. 任一风险动作都必须追加审计与告警事件。

---

## 4. 流动性风控实现

## 4.1 指标定义

核心指标：

$$
LiquidityRatio = \frac{VaultAvailable}{Expected24hNetOutflow}
$$

字段定义：
1. `VaultAvailable`
   - 金库可立即用于兑付的 USDC（链上可用 + 热钱包 + 可立即解锁金额 - 已预留未提交链上提现）。
2. `Expected24hNetOutflow`
   - 未来 24h 预期净流出 = 提现预计流出 - 充值预计流入（保守估计，最小化高估流入）。

工程建议：
1. `Expected24hNetOutflow` 使用 `max(rolling_24h_outflow * alpha, min_outflow_floor)`。
2. `alpha` 初始建议 `1.15`，应对异常波动。
3. `min_outflow_floor` 防止分母过小导致虚高比值。

## 4.2 决策阈值

1. `GREEN`: `ratio >= 1.5`
2. `YELLOW`: `1.1 <= ratio < 1.5`
3. `RED`: `ratio < 1.1` 或“单笔超大额请求命中 hard_cap”

## 4.3 阈值联动动作

1. GREEN
   - 保持当前提现自动阈值（如 100 USDC）。
2. YELLOW
   - 下调自动提现阈值（如 100 -> 50）。
   - 对边缘请求强制人工审核。
3. RED
   - 暂停所有自动签发。
   - 新提现默认 `PENDING_MANUAL_REVIEW` 或直接拒绝（按策略开关）。

## 4.4 评估频率与缓存

1. 实时评估：提现请求进入时计算一次（强一致）。
2. 周期评估：每 30s 刷新一次系统级快照（性能优化）。
3. Redis 缓存：缓存最近快照，TTL 建议 20s；真实决策仍以 PostgreSQL + 链上读数为准。

---

## 5. 数据模型设计（PostgreSQL）

## 5.1 流动性快照表

表：`synapse_liquidity_snapshot`

字段：
1. `id` (bigserial, pk)
2. `vault_available_usdc` (numeric(36,6), not null)
3. `expected_24h_net_outflow_usdc` (numeric(36,6), not null)
4. `liquidity_ratio` (numeric(18,6), not null)
5. `liquidity_level` (`green|yellow|red`)
6. `alpha` (numeric(10,4), not null)
7. `data_freshness_sec` (int, not null)
8. `created_at` (bigint, not null)

索引：
1. `idx_liquidity_snapshot_created_at_desc`

## 5.2 风险事件表

表：`synapse_risk_events`

字段：
1. `event_id` (text, pk)
2. `event_type` (text) 例：`LIQUIDITY_RED`, `WITHDRAW_RED`, `MANUAL_REVIEW_TIMEOUT`
3. `severity` (`P1|P2|P3`)
4. `owner_address` (text, nullable)
5. `request_id` (text, nullable)
6. `risk_level` (`green|yellow|red`)
7. `risk_reason_code` (text)
8. `payload` (jsonb)
9. `dedup_key` (text)
10. `status` (`OPEN|ACKED|RESOLVED`)
11. `created_at` (bigint)
12. `updated_at` (bigint)

约束：
1. `UNIQUE(dedup_key, status)` 可选，或由应用层做 5 分钟去重窗口。

## 5.3 人工审核工单表

表：`synapse_manual_review_tickets`

字段：
1. `ticket_id` (text, pk)
2. `business_type` (`withdraw|refund`)
3. `owner_address` (text, not null)
4. `request_id` (text, not null)
5. `amount_usdc` (numeric(36,6), not null)
6. `risk_level` (`yellow|red`)
7. `risk_reason_code` (text)
8. `evidence_summary` (text)
9. `status` (`PENDING|CLAIMED|APPROVED|REJECTED|ESCALATED|EXPIRED`)
10. `assignee` (text, nullable)
11. `reviewer_note` (text, nullable)
12. `sla_deadline_at` (bigint)
13. `created_at` (bigint)
14. `updated_at` (bigint)

索引：
1. `idx_manual_review_status_created_at`
2. `idx_manual_review_owner_created_at`

## 5.4 审核动作日志表（Append-only）

表：`synapse_manual_review_actions`

字段：
1. `id` (bigserial, pk)
2. `ticket_id` (text)
3. `action` (`CREATE|CLAIM|APPROVE|REJECT|ESCALATE|AUTO_EXPIRE`)
4. `actor` (text)
5. `note` (text)
6. `payload` (jsonb)
7. `created_at` (bigint)

规则：
1. 禁止更新删除，只允许插入。

---

## 6. 服务实现设计

## 6.1 LiquidityGuardService 接口

```python
class LiquidityGuardService:
    def evaluate(self, *, now_ts: int, request_amount_usdc: Decimal) -> LiquidityDecision:
        ...
```

返回：
1. `level`: `green|yellow|red`
2. `ratio`: Decimal
3. `effective_auto_withdraw_limit`: Decimal
4. `reason_code`: str
5. `snapshot_id`: int

## 6.2 RiskDecisionOrchestrator 伪代码

```text
1) load withdraw risk result (green/yellow/red)
2) load liquidity result (green/yellow/red)
3) final_level = max(risk_level, liquidity_level)
4) if final_level == red: reject or force_manual (by config)
5) if final_level == yellow: create manual ticket
6) if final_level == green: auto approve and sign
7) append audit + emit risk event
```

## 6.3 并发与一致性

1. 决策和资金冻结必须在同事务边界内衔接。
2. 人工审核工单创建与提现状态变更同事务提交。
3. 使用行锁避免同 request 重复入队。

---

## 7. 告警系统实现

## 7.1 事件分级规则

1. P1
   - `LIQUIDITY_RED`
   - `WITHDRAW_RED`
   - `SUSPECTED_ACCOUNT_TAKEOVER`
2. P2
   - `LIQUIDITY_YELLOW_PERSIST_10M`
   - `MANUAL_REVIEW_BACKLOG_HIGH`
3. P3
   - `RISK_SCORE_SPIKE_SINGLE_ACCOUNT`

## 7.2 告警去重与升级

1. 去重窗口：同 `dedup_key` 5 分钟内仅发送一次。
2. 升级规则：
   - P2 连续 3 次触发 -> 升级 P1。
   - 工单超时 > SLA -> 触发 P1 升级。

## 7.3 通道策略

1. Feishu：默认主通道（结构化消息卡片）。
2. Telegram：值班同步。
3. PagerDuty：仅 P1。

## 7.4 告警消息模板（最小披露）

字段：
1. `severity`
2. `event_type`
3. `request_id`
4. `owner_masked`
5. `risk_reason_code`
6. `action_required`
7. `runbook_link`

禁止项：
1. 不发送完整 token、密钥、内部 SQL。

---

## 8. 人工审核 SOP（可执行版本）

## 8.1 角色

1. `L1 Reviewer`：一线审核，处理常规黄灯。
2. `L2 Risk Lead`：处理红灯/争议单。
3. `On-call Commander`：P1 事件指挥。

## 8.2 流程

1. 入队
   - 系统创建 ticket，状态 `PENDING`。
2. 领取
   - 审核员 `CLAIM`，状态 `CLAIMED`。
3. 审核
   - 拉取地址图谱、设备/IP、历史净收入、调用真实性。
4. 决策
   - `APPROVED`: 放行并记录审计。
   - `REJECTED`: 拒绝并可冻结观察。
   - `ESCALATED`: 升级 L2。
5. 归档
   - 输出结构化结论，追加 action log。

## 8.3 SLA

1. P1：5 分钟内响应，30 分钟内给出处置动作。
2. P2：15 分钟内响应，4 小时内处理。
3. P3：当日处理。

## 8.4 超时自动化

1. Ticket 超时未领取 -> 触发 `MANUAL_REVIEW_UNCLAIMED_TIMEOUT`。
2. Ticket 已领取未结案 -> 触发 `MANUAL_REVIEW_PROCESSING_TIMEOUT`。
3. 超时达到阈值自动升级告警等级。

---

## 9. API 设计（内部管理面）

建议新增内部接口（仅管理员会话可访问）：

1. `GET /api/v1/risk/liquidity/snapshot/latest`
2. `GET /api/v1/risk/events?severity=&status=&limit=`
3. `POST /api/v1/risk/events/{eventId}/ack`
4. `GET /api/v1/risk/manual-reviews?status=&assignee=`
5. `POST /api/v1/risk/manual-reviews/{ticketId}/claim`
6. `POST /api/v1/risk/manual-reviews/{ticketId}/decision`

决策请求体：

```json
{
  "decision": "APPROVE",
  "reviewerAddress": "0x...",
  "reviewerNote": "checked device stability and traffic provenance",
  "evidenceSummary": "..."
}
```

---

## 10. 配置项

新增配置（`src/core/config.py`）：

1. `LIQUIDITY_RATIO_GREEN_MIN=1.5`
2. `LIQUIDITY_RATIO_YELLOW_MIN=1.1`
3. `LIQUIDITY_ALPHA=1.15`
4. `LIQUIDITY_MIN_OUTFLOW_FLOOR_USDC=1000`
5. `LIQUIDITY_YELLOW_AUTO_WITHDRAW_LIMIT_USDC=50`
6. `RISK_ALERT_DEDUP_WINDOW_SEC=300`
7. `MANUAL_REVIEW_P1_SLA_SEC=1800`
8. `MANUAL_REVIEW_P2_SLA_SEC=14400`
9. `MANUAL_REVIEW_AUTO_ESCALATE_ENABLED=true`

---

## 11. 失败模式与降级策略

1. 链上余额读取超时
   - 使用最近快照 + 安全折扣，默认倾向更严格等级。
2. 告警通道不可用
   - 本地持久化重试队列 + 指数退避。
3. 人工审核系统不可用
   - 自动切换为“全部人工冻结，不自动签发”。
4. Redis 故障
   - 不影响最终决策正确性，回退 PostgreSQL。

---

## 12. 测试与验收

## 12.1 单元测试

1. `LiquidityGuardService` 阈值边界测试。
2. 告警去重与升级规则测试。
3. 审核状态机合法迁移测试。

## 12.2 集成测试

1. 提现请求命中流动性 yellow，自动降阈值。
2. 提现请求命中流动性 red，触发 P1 + 人工审核。
3. 审核通过/拒绝后资金状态与审计一致。

## 12.3 压测与演练

1. 模拟 10 分钟内 10x 提现洪峰。
2. 验证告警吞吐与去重准确率。
3. 验证人工审核 backlog 和升级链路。

验收门槛：
1. 资金一致性 0 偏差。
2. P1 告警送达率 >= 99.9%。
3. 手工回放审计链路可还原关键决策。

---

## 13. 上线计划

1. 第 1 周
   - 表结构上线 + Liquidity 快照任务 + 只读告警。
2. 第 2 周
   - 开启提现前流动性闸门（仅 yellow 生效）。
3. 第 3 周
   - 开启 red 熔断 + 人工审核工单系统。
4. 第 4 周
   - 开启自动升级与完整值班 SOP。

回滚策略：
1. 可通过配置关闭 `LIQUIDITY_GUARD_ENABLED`。
2. 回退为“仅提现三段阀门，不叠加流动性规则”。

---

## 14. 运维 Runbook 摘要

1. 发现 `LIQUIDITY_RED`
   - 立即冻结自动签发。
   - 通知资金运营与链上值班。
   - 核查链上可用金库、待处理提现、异常账户。
2. 15 分钟未恢复
   - 提升为事故态，启动 Incident Commander。
3. 恢复条件
   - `ratio >= 1.2` 持续 10 分钟以上，且 backlog 回落到阈值内。

---

## 15. 交付清单（Definition of Done）

1. 数据库 migration 与索引完成。
2. 服务层实现 + 管理接口实现。
3. 审计与告警链路全打通。
4. 文档更新（本文件 + API 文档 + 运维手册）。
5. 单测、集成、压测、演练报告齐全。

> 执行口令：先保命，再提速。流动性红线一旦触发，系统自动签发必须让位于人工审慎。