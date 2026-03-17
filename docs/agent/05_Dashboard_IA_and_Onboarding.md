# Dashboard 信息架构和 Onboarding 流程

> 目标：定义 Owner 控制台的信息架构、首次激活路径和页面承担的真实职责。

## 1. Dashboard 的真实职责

Dashboard 不是交易主战场，它是 Owner 的控制台。

它的职责只有四个：

1. 让 Owner 快速完成启动配置
2. 让 Owner 快速知道 Agent 是否在赚钱或烧钱
3. 让 Owner 快速发现风险并止损
4. 让 Owner 快速拿到 SDK、Credential 和示例

## 2. 信息架构

建议 V1 导航结构如下：

1. **Overview**
   看总余额、今日消费、成功调用数、异常率、Top Agent。
2. **Agents**
   管理 Agent、Credential、预算、状态。
3. **Discovery**
   预览服务市场、查看 Manifest、手工验证服务可发现性。
4. **Invocations**
   查看调用记录、报价、耗时、结果状态、错误码。
5. **Billing**
   看账本、充值、扣费、平台费用与服务维度消费分布。
6. **Risk & Audit**
   看预算告警、限流告警、异常调用、审计轨迹。
7. **Developer**
   拿 SDK、API 文档、Quickstart、Webhook / MCP 集成说明。

补充边界：

- Dashboard 是 Owner 控制面，不是 Agent-facing 协议本身。
- 即使在 Dashboard 中，也应该优先展示 service 维度的消费和调用结果，而不是把卖家内部结算身份暴露成主 UI 结构。

## 3. 首次 Onboarding 五步流

Owner 的首次体验必须压缩成 5 步：

1. **Connect Wallet**
   连接主钱包，识别 owner 身份。
2. **Deposit USDC**
   给主金库充值，展示可用余额。
3. **Create Agent**
   填 Agent 名称、用途、风险级别。
4. **Issue Credential + Set Budget**
   一键生成 credential，并设置总预算、日预算、单次上限。
5. **Run First Paid Invocation**
   提供一个官方 demo task，真实走完 Discovery -> Quote -> Invoke。

第五步必须是 onboarding 的终点。不然你只是完成了开户，没有完成激活。

## 4. 首次成功页必须展示什么

第一次付费调用成功后，页面要明确展示：

- 调用了哪个 service
- 花了多少 USDC
- 返回了什么结果
- 余额还剩多少
- credential 当前预算还剩多少
- 下一步怎么把这条链路接进自己的 Agent

默认不需要展示：

- 卖家钱包地址
- 平台内部拆账比例
- 内部账本流水主键

目标是让 Owner 立刻理解：

“不是我在手工点 API，而是我的 Agent 已经能自动消费了。”

## 5. Discovery 页面原则

Discovery 页面不要做成电商商品瀑布流。

正确的做法是：

- 左侧是筛选和任务意图
- 中间是候选服务排名
- 右侧是 Manifest 预览、价格、成功率、示例输出

页面目标不是刺激人类冲动消费，而是帮助 Owner 理解 Agent 为什么会选这个服务。

补充要求：

- Discovery 页默认展示 service 信息，不展示 `seller_wallet` 这类内部结算字段。
- 如果后续需要展示卖家品牌，也应以 Seller Profile 的展示层字段呈现，而不是暴露结算地址。

## 6. Agents 页面必须一眼看到什么

每个 Agent 卡片至少展示：

- Agent 名称
- Credential 状态
- 生命周期预算使用率
- 今日预算使用率
- 最近 24h 调用数
- 成功率
- 最常调用的服务
- 最后一次异常原因

否则 Owner 无法快速判断哪个 Agent 是印钞机，哪个 Agent 是炸弹。

## 7. Developer 页面必须给什么

Developer 区域必须直接给：

1. SDK 安装命令
2. 创建 credential 的示例
3. Discovery 示例
4. Quote 示例
5. Invoke 示例
6. Python / TypeScript 两套最短 Quickstart
7. MCP / Tool adapter 集成说明

这里越短越好，越能推动首个付费调用。

## 8. 设计结论

Dashboard 的目标不是让人类替 Agent 干活，而是让 Owner 用最低认知负担完成授权、控制、观测和止损。