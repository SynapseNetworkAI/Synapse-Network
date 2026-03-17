# Dashboard Onboarding and Information Architecture

> 这份文档定义 Dashboard 的 canonical target-state 设计。旧的双模式角色切换叙事已废弃，后续前端重构以本文为准。

## 1. 产品目标

Dashboard 的目标不是让人类在平台里手工切换旧角色模式，而是让同一个 Owner 在一个统一身份入口下完成三件事：

1. 为 Agent Runtime 注资并管理消费能力
2. 以 Provider 角色注册和运营自己的服务
3. 观察同一个 Owner 下面的消费、收益、预算和风险状态

一句话：

**一个 Owner，多个 Workspace，多类资金桶。**

## 2. 顶层信息架构

Dashboard 应该采用：

1. 一个统一身份入口
2. 两个主要业务工作区
3. 一组横向 owner-level 公共页面

### 2.1 统一身份入口

统一使用：

1. 钱包连接
2. platform session
3. owner-scoped API auth

不再拆成：

1. 消费侧登录
2. 供给侧登录

### 2.2 两个核心 Workspace

#### Agent Workspace

面向 Owner 的消费侧控制面。

包含：

1. Add Funds
2. Spendable Balance
3. Agent 管理
4. Agent Credential / Budget Policy
5. Discovery / Quote / Invoke 观测
6. Refund
7. Usage Logs

#### Provider Workspace

面向同一个 Owner 的供给侧控制面。

包含：

1. Service Manifest 管理
2. Provider Health / Routing / Metering
3. Earnings Summary
4. Provider Receivable
5. Withdrawals
6. Provider Usage / Revenue Analytics

### 2.3 横向公共页面

这些页面属于 Owner 层，而不是单独属于 Agent Workspace 或 Provider Workspace：

1. Identity / Session
2. Wallet / Vault
3. Unified Finance Overview
4. Unified Audit Timeline
5. Security / Access Control

## 3. 首屏 Hero 应该怎么讲

首页 Hero 必须抛弃“你是买家还是卖家”的老话术，改成：

- 标题：`One Owner. Two Workspaces. Infinite Agent Commerce.`
- 副标题：`Fund your agents, operate your services, and manage unified settlement from one platform identity.`

首屏 CTA：

1. `Open Agent Workspace`
2. `Open Provider Workspace`

辅助说明：

1. Agent Workspace 负责花钱和调用
2. Provider Workspace 负责供给和赚钱
3. 两边都属于同一个 Owner，不需要切换账号

## 4. 新用户引导应该怎么做

首次进入 Dashboard，不再询问用户属于哪种旧角色类型，而是询问：

1. 你现在想先做什么
2. 你的 Owner 当前是否已经有消费侧余额
3. 你的 Owner 当前是否已经注册过服务

建议引导分流：

### 4.1 路径 A: Start Using Services

适合还没有开始消费的 Owner。

步骤：

1. Connect Wallet
2. Sign Session
3. Add Funds
4. Create Agent
5. Issue Credential
6. Discover and invoke first service

### 4.2 路径 B: Start Selling Services

适合想作为 Provider 接入服务的 Owner。

步骤：

1. Connect Wallet
2. Sign Session
3. Open Provider Workspace
4. Register Service Manifest
5. Configure health / routing / metering
6. Publish and monitor earnings

### 4.3 路径 C: I do both

适合同一个 Owner 同时消费和供给。

步骤：

1. Finish wallet + session once
2. Add funds to Agent Workspace
3. Register services in Provider Workspace
4. Track Spendable Balance and Provider Receivable separately

## 5. Dashboard 首页模块

Overview 首页应该只做 4 组卡片。

### 5.1 Workspace Entry Cards

1. Agent Workspace
2. Provider Workspace

每张卡片必须说明：

1. 这块能做什么
2. 当前完成度如何
3. 下一步建议动作是什么

### 5.2 Finance Buckets Overview

首页必须把资金分桶展示，而不是只展示一个余额数。

最少显示：

1. `Spendable Balance`
2. `Provider Receivable`
3. `Pending Deposits`
4. `Locked Refunds / Locked Withdrawals`

### 5.3 Runtime Overview

1. Agent count
2. Active credentials
3. Daily spend
4. Latest invocations

### 5.4 Provider Overview

1. Service count
2. Healthy services
3. Today earnings
4. Pending withdrawals

## 6. 财务 UI 设计原则

### 6.1 不再使用旧角色名作为主文案

前端主文案统一改成：

1. `Spendable Balance`
2. `Provider Receivable`
3. `Platform Fee Pool`
4. `Refund`
5. `Withdrawal`

### 6.2 两张核心资金卡片

#### Spendable Balance

说明：

1. 来源于 Owner 对 Vault 的入金
2. 用于 Agent Runtime 消费
3. 对应 Add Funds / Refund

#### Provider Receivable

说明：

1. 来源于服务调用累计收益
2. 用于 Provider Withdrawal
3. 不等于 Spendable Balance

### 6.3 一个总览，两个明细

Owner Finance Overview 页面应同时展示：

1. 一个 owner-level 总览
2. 一个 consumer-bucket 明细表
3. 一个 provider-bucket 明细表

## 7. 页面结构建议

### 7.1 Agent Workspace

导航建议：

1. `Overview`
2. `Add Funds`
3. `Agents`
4. `Credentials`
5. `Usage`
6. `Refunds`

### 7.2 Provider Workspace

导航建议：

1. `Overview`
2. `Services`
3. `Health & Routing`
4. `Revenue`
5. `Withdrawals`
6. `Provider Audit`

### 7.3 Shared Pages

1. `Finance Overview`
2. `Audit Timeline`
3. `Wallet & Session`
4. `Security`

## 8. 用户心智文案

页面中应该反复强化这一句：

**You are still the same Owner. You are just operating different workspaces.**

对应中文：

**你始终是同一个 Owner，只是在平台里操作不同工作区。**

## 9. 状态和错误文案规范

- 未连接钱包：`Connect your wallet to access owner workspace.`
- 已连钱包未登录：`Sign the session message to access owner-scoped data.`
- Spendable Balance 不足：`Insufficient spendable balance. Add funds first.`
- Provider Receivable 为 0：`No provider receivable available for withdrawal yet.`
- Credential 失效：`Credential is inactive or expired. Re-issue from Agent Workspace.`

## 10. 验收标准

1. 新用户在 30 秒内能理解平台是“一个 Owner，两个 Workspace”。
2. 用户不会误以为需要注册两个账号。
3. 用户能清楚区分 `Spendable Balance` 和 `Provider Receivable`。
4. 同一个 Owner 可以在一次登录后同时完成“充值调用”和“注册服务”。
5. 页面结构不再使用旧角色切换作为顶层 IA 语言。

## 11. 结论

Dashboard 不是旧式角色模式选择器，而是：

**同一个 Owner 的 unified control plane for agent commerce.**
