# Frontend Design System Application

## 1. 目标

`docs/Design.md` 定义了视觉与交互基线，本文件定义这些原则在 Synapse 具体页面里的落地方式。

它回答：

1. 设计系统在 Gateway Console、Provider Workspace、Admin Control Plane 中如何统一
2. 哪些视觉决策是品牌层，哪些是金融信息层
3. 如何避免产品迭代中重新滑回“吵闹的 Web3 面板风”

## 2. 总体原则

### 2.1 Credibility First

所有页面都应优先让用户感到：

1. 资金可信
2. 状态可信
3. 风险提示可信

### 2.2 Information Before Decoration

任何视觉装饰都不能盖过：

1. 余额
2. 调用状态
3. 风险状态
4. 收益状态

### 2.3 System-wide Consistency

以下对象必须全站一致：

1. 状态色
2. 按钮级别
3. 卡片层级
4. 数据表结构节奏
5. 告警反馈方式

## 3. 颜色策略

沿用 `docs/Design.md` 的 95/5 原则：

1. 95% 黑白灰做结构层和阅读层
2. 5% 信号色只做状态和资金流强调

### 3.1 允许高亮的对象

1. 成功执行
2. 可消费余额
3. 可提现收益
4. 主 CTA
5. 健康度信号

### 3.2 不允许高亮泛滥的对象

1. 每张卡片的背景
2. 全屏按钮区
3. 全局边框
4. 普通辅助标签

## 4. 页面节奏

### 4.1 Overview 页

节奏必须是：

1. 先看总状态
2. 再看下一步动作
3. 最后看少量摘要表

### 4.2 Workspaces

工作页必须是：

1. 顶部 summary
2. 中部主操作区
3. 底部详情和历史

不能一上来就塞满大表。

## 5. 组件规范

### 5.1 KPI Cards

适合展示：

1. spendable balance
2. provider receivable
3. invocation success rate
4. pending reviews

不适合承载复杂解释文本。

### 5.2 Tables

表格用于真相明细，不用于讲故事。

表格字段必须围绕业务对象组织，例如：

1. invocation id
2. service
3. charged usdc
4. status
5. call time

而不是堆底层调试字段。

### 5.3 Status Badges

Badge 只服务于：

1. active / paused / archived
2. pending / confirmed / failed
3. healthy / degraded / unavailable
4. green / yellow / red risk

不要把 badge 用成装饰标签雨。

## 6. 文案原则

### 6.1 统一术语

必须统一使用：

1. Owner
2. Agent
3. Provider
4. Platform Gateway
5. Deposit
6. Withdrawal
7. Spendable balance
8. Provider receivable

### 6.2 严禁回退到旧术语

不再使用：

1. Buyer / Seller 作为主文案
2. API key 作为 Runtime 主叙事
3. 钱包中心 / 卖家中心 作为 IA 主标题

## 7. 页面级应用

### 7.1 Gateway Console

重点表现：

1. 资金可信度
2. Agent 执行闭环
3. 风险提示

### 7.2 Provider Workspace

重点表现：

1. 服务上线状态
2. 收益状态
3. 提现状态

### 7.3 Admin Control Plane

重点表现：

1. 风险等级
2. 审批积压
3. 对账异常
4. 管理员责任链

## 8. 文档结论

Synapse 的前端设计系统不是“统一一套组件库”这么简单，而是把金融基础设施的可信感、执行感和治理感贯彻到每一层页面。

如果视觉系统不能服务资金和状态的正确理解，那它就只是漂亮的噪音。