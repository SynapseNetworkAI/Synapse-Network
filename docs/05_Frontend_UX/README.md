# Frontend UX Map

本目录承载 Synapse 前端的信息架构、页面体验和关键用户路径设计。

它服务的不是“传统 SaaS 控制台”，而是：

1. Owner 的控制面体验。
2. Agent Workspace 的运行时观测体验。
3. Provider Workspace 的服务与收益运营体验。

## 推荐阅读顺序

1. [../Design.md](../Design.md)
   全局视觉与交互基线。
2. [Owner_Overview_Agent_Workspace_Design.md](./Owner_Overview_Agent_Workspace_Design.md)
   Owner / Agent Workspace 的总览页与工作区设计。
3. [Overview_Design.md](./Overview_Design.md)
   总览页和核心信息层次补充。
4. `../feature_designs/frontend_product/`
   更细的专题设计，如 Homepage、Provider Console、鉴权挑战、Key 管理。

## 本目录关注的功能域

1. 首页与品牌叙事
2. Owner 钱包与资金总览
3. Agent Workspace
4. 服务发现与调用观测
5. 充值、退款、提现体验
6. Provider Console 与收益视图

## 与其他目录的边界

1. 页面结构、交互、体验：本目录。
2. 更细的前端专题设计：`docs/feature_designs/frontend_product/`。
3. Runtime 协议和 API：`docs/agent/` 与 `docs/api.md`。
4. 资金链路真相：`docs/03_Smart_Contract_Payment/`。

## 维护规则

1. 前端体验文档必须遵守 `Owner / Agent / Provider` 新术语，不再退回旧角色词。
2. 如果页面真实实现已经发生变化，先更新这里的 IA 和页面入口，再补专题设计文档。