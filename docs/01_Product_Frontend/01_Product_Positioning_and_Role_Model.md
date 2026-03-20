# Product Positioning and Role Model

## 1. 产品定位

Synapse Network 不是传统的 API Marketplace，也不是单纯的链上支付中间件。

它的准确定位是：

**面向 AI Agent 的 API 支付、路由、结算与审计基础设施。**

这意味着平台要同时做好四件事：

1. 让 Owner 一次性完成授权、入金和预算设定
2. 让 Agent Runtime 稳定 discover、quote、invoke 并自动消费
3. 让 Provider 把服务标准化接入网络并稳定收款
4. 让 Platform 用统一账本和审计层承载风控、分账和对账

## 2. 产品北极星

唯一正确的核心激活指标是：

**Agent completed first paid invocation autonomously.**

因此，所有产品设计都要服从这个结果，而不是服从传统 Web2 控制台的“页面做全、表格做满”。

## 3. 角色模型

### 3.1 Owner

Owner 是根身份。

职责：

1. 连接钱包并建立平台 session
2. 给 Vault 入金
3. 创建 Agent
4. 签发 credential
5. 设预算和速率边界
6. 注册 Provider 服务
7. 查看账单、收益、提现和风险告警

### 3.2 Agent

Agent 是 Runtime 执行主体。

职责：

1. Discovery
2. Quote
3. Invoke
4. 消耗预算

Agent 不接触 Owner 主钱包，也不操作 Provider 控制面。

### 3.3 Provider

Provider 不是独立根账户，而是 Owner 在供给侧的业务角色。

职责：

1. 注册 Service Manifest
2. 维护 endpoint 和健康度
3. 运营定价和能力说明
4. 查看收益与发起提现

### 3.4 Platform Gateway

Platform 是内部执行和结算角色。

职责：

1. 鉴权
2. 预算校验
3. Gateway 路由转发
4. Ledger / Audit / Settlement
5. Risk control

## 4. 核心用例

### 4.1 Owner 用例

Owner 不是来手工调 API 的，而是来：

1. 充值
2. 创建 Agent
3. 发 credential
4. 设预算
5. 观察 Agent 是否健康消费
6. 运营自己在供给侧的服务

### 4.2 Provider 用例

Provider 的主路径不是“做一页卖家资料页”，而是：

1. 建立 Provider profile
2. 绑定 payout 地址
3. 发布服务 manifest
4. 观察调用量和收益
5. 提现

### 4.3 Gateway 用例

Gateway 不是 UI 用户，但前端必须正确表现 Gateway 的角色：

1. 它是执行管线，不是营销对象
2. 它承担可信转发和可信记账
3. 它应该被 Owner 感知为“金融级控制与审计基础设施”

## 5. 产品叙事必须废弃的旧心智

以下叙事都必须彻底废弃：

1. “Buyer 和 Seller 是两套根账户体系”
2. “Owner 需要一个 Developer Console，把充值、凭据签发、文档入口全部塞进同一页”
3. “Provider 的本质是公开钱包地址和手工填商品页”
4. “Dashboard 首屏应该堆所有表格和所有细节”

## 6. 产品信息层级

产品对外表达，必须围绕四层：

1. Funding
   Owner 把钱放进平台资金层
2. Runtime
   Agent 在预算边界内发现、调用、消费
3. Supply
   Provider 提供能力并积累收益
4. Governance
   Platform 执行路由、审计、对账、风控和治理

## 7. 页面如何映射角色模型

### 7.1 Gateway Console

服务对象：Owner 和 Provider role。

核心目标：

1. 授权
2. 配置
3. 观测
4. 止损

### 7.2 Admin Control Plane

服务对象：Platform 内部管理员。

当前实现边界必须明确：Admin Control Plane 不属于 `apps/frontend` 这套 Gateway Console / Provider Workspace 前端。
它应落在独立的 `admin/admin-front` + `admin/gateway-admin` 体系中。

核心目标：

1. 审批
2. 风控
3. 对账
4. 治理

### 7.3 Runtime 协议面

服务对象：Agent。

核心目标：

1. 发现服务
2. 获取报价
3. 执行调用

它不应被 UI 页面结构反向污染。

## 8. 文档结论

Synapse 的产品建模已经非常明确：

1. Owner 是根主体
2. Agent 是执行主体
3. Provider 是供给侧角色
4. Platform 是内部执行和结算层

所有前端页面、产品文案和 IA 设计，都必须围绕这个角色模型组织，而不是再回到旧时代的用户角色混战。

补充约束：

1. `apps/frontend` 只承载 Owner Gateway Console 和 Provider Workspace。
2. 平台管理员前端属于 `admin/admin-front`，后台治理 API 属于 `admin/gateway-admin`。
3. 不要再把 admin workflow 作为 `dashboard/*` 的隐藏入口来设计。