# Development, Testing, and Integration Reference

## 1. 目标

本文件给开发者、测试者和集成方一个最低共识清单，确保代码、测试、文档和 SDK 集成用的是同一套事实。

## 2. 后端开发最低共识

后端本地开发的核心目标，是还原这条主链路：

1. Owner 完成入金
2. Gateway Indexer 确认充值
3. Agent 通过 Gateway 发起调用
4. Provider endpoint 被转发
5. Gateway 完成原子结算和审计

## 3. 测试优先级

至少覆盖：

1. owner-scoped auth and isolation
2. agent credential and budget enforcement
3. deposit idempotency and confirmation
4. gateway forwarding success and failure
5. consumer charge capture and rollback
6. provider receivable accrual and withdrawal review
7. audit emission and runtime state persistence

## 4. 测试命名规则

推荐使用业务意图命名，例如：

1. confirm deposit moves pending to available
2. invoke capture accrues provider receivable
3. withdrawal yellow path moves receivable to locked

## 5. 最小执行分层

测试至少分成：

1. unit
2. integration
3. performance

性能测试应显式 gated，不应默认阻塞所有本地回归。

## 6. Agent SDK 集成最低前提

SDK 调用前至少要具备：

1. 有效 Agent Credential
2. Owner 已完成入金并确认到账
3. 可访问的平台 Gateway URL

最小 Runtime 路径始终是：

1. discover
2. select or quote
3. invoke
4. receive unified result and billing facts

## 7. 文档与测试一致性

任何行为变化，都必须同步更新：

1. 实现代码
2. 测试断言
3. 文档说明

三者不一致时，以真实代码行为为准，但必须立刻修正文档和测试。

## 8. 文档结论

开发参考的真正价值，不是教人怎么跑单条命令，而是确保整个团队围绕同一条 Agent-first 主链路开发、测试、联调和回归。