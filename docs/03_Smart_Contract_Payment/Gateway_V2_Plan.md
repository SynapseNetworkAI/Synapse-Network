# 平台网关 V2 最小实现任务拆解（8 接口）

> 目标：基于“平台网关中转 + Deposit + Credential + 账本结算”架构，给出可直接开发排期的最小任务清单。

## 1. 版本边界（MVP）

- 只做单链（localhost / 单 EVM 网络）
- 只做 USDC 资产
- 只做平台网关转发（买家不直连卖家）
- 保留现有钱包签名登录机制
- 先支持手动凭据签发（自动轮转放后续）

## 2. 最小 8 个接口

### A. 控制面（2）

1) `POST /api/v1/agents`
- 作用：创建 agent
- 鉴权：owner token
- 输出：agent 基本信息

2) `POST /api/v1/services`
- 作用：注册卖家 service
- 鉴权：owner token
- 输出：service 配置（`serviceId`, `price`, `feeRate`, `endpoint`）

### B. 资金面（3）

3) `POST /api/v1/deposit/confirm`
- 作用：写入充值到账（由 indexer/内部任务调用）
- 入参：`txHash`, `buyerAddress`, `amount`, `token`, `chainId`
- 输出：`buyerBalance` 最新值

4) `GET /api/v1/balance`
- 作用：查询买家余额
- 鉴权：buyer token + `X-User-Address`
- 输出：`available`, `locked`, `updatedAt`

5) `POST /api/v1/settlement/run`
- 作用：按阈值/批次发起结算（管理端或 cron）
- 输出：`batchId`, `txHash`, `sellerCount`, `totalNet`, `totalFee`

### C. 凭据面（2）

6) `POST /api/v1/credentials/issue`
- 作用：签发 `X-Agent-Credential`
- 鉴权：owner token
- 入参：`agentId`, `serviceScope`, `exp`, `maxCalls`, `rpm`

7) `POST /api/v1/credentials/{id}/revoke`
- 作用：撤销凭据
- 鉴权：owner token

### D. 数据面（1）

8) `POST /api/v1/gateway/generate`
- 作用：网关入口（验证 + 记账 + 转发）
- 输入头：`Authorization`, `X-User-Address`, `X-Agent-Credential`, `X-Request-Id`
- 输出：seller 结果 + 计费摘要

## 3. `POST /api/v1/gateway/generate` 内部步骤（强约束）

1. 校验会话与钱包一致性
2. 校验凭据：未过期/未撤销/作用域匹配/未超配额
3. 原子余额校验：`buyerBalance >= unitPrice`
4. 写 usage 草稿（`accepted`）
5. 调用 seller endpoint（内部签名头）
6. 成功：固化扣费、增加卖家应收与平台费、usage=`succeeded`
7. 失败：回滚或标记退款、usage=`failed/refunded`
8. 返回响应

## 4. 开发顺序（建议两周）

### Week 1
- D1-D2：资金账本模型 + deposit confirm
- D3：credential issue/revoke
- D4：service 注册与查询
- D5：`/api/v1/gateway/generate` 骨架 + mock 转发

### Week 2
- D1：`/api/v1/gateway/generate` 原子扣费 + 幂等
- D2：usage 日志 + 审计
- D3：settlement run（单批次）
- D4：e2e 联调（deposit -> generate -> settlement）
- D5：灰度开关与回滚预案

## 5. 验收标准（MVP）

- 买家充值后余额可见
- 凭据可签发/撤销，过期不可用
- 无余额或凭据无效时网关拒绝
- 网关成功转发后账本正确扣费
- 结算任务可把卖家应收上链清算
- 全链路可追踪：`requestId -> usage -> settlementBatch -> txHash`

## 6. 非目标（本期不做）

- 多链路由
- 自动凭据轮转
- 动态费率引擎
- 复杂争议仲裁
