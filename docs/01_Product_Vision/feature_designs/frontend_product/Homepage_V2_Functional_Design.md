# Homepage V2 功能设计（Functional Design)

## 1. 目标

Homepage V2 的功能目标不是展示炫技，而是形成可转化、可探索、可扩展的首页入口层：

- 一屏建立产品认知（是什么、解决什么问题）
- 第一屏必须极简，只负责打入一个世界观，不承担角色教育和流程解释
- 提供清晰导航入口（Marketplace / Blog / About / Language）
- 提供可消费的服务发现能力（Registered Services）
- 支持中英文切换，形成全局 i18n 基础设施

## 2. 信息结构（IA）

1. 顶部导航（Global Navbar）
- Brand: Synapse Network
- Brand lockup: precision monogram + wordmark, not hacker text effect
- Status: Gateway Node
- Links: API Marketplace / Blog / About
- Language: EN / ZH

2. Hero
- 首屏只保留：Logo/Nav、巨型 Headline、Subheadline、Trade 标语、三项实时网络计数、弱环境信号层
- 主叙事标题拆成两段：`Fund once. Agents discover and` + `pay for APIs.`
- `pay` 必须成为字重、节奏和视觉重心
- 桌面端标题优先保证单行成立，尺寸显著收敛，避免巨型字压垮留白
- 副标题：强调 runtime identity、budgeted payments、instant settlement
- 标语：`Agents can talk. But now, they can trade.`
- 首屏不再放 CTA、标签条、命令条或解释型模块，必须为标题留出足够呼吸感
- 首屏底部允许保留 3 项轻量实时计数：`API calls / registered services / connected agents`
- 这 3 个数字必须更像 live signal rail，而不是 dashboard cards
- 实时数据默认无边框、无厚重底板，主要依靠字号、节奏、间距与微弱光感建立动态信号感
- 首屏目标不是解释完产品，而是用留白和排版建立基础设施级可信度
- 背景动效：只允许极弱的 signal beam / orb / node / flow 漂移，不允许 flashy 粒子、地图、炫光扫屏
- 可借鉴广播网络/全球连线的张力，但只能抽象成极弱曲线信号、稀疏节点、低频脉冲，不允许直接上地图大图层
- 导航质感：悬浮玻璃胶囊 + 更细的高光边界 + 柔和状态脉冲，接近 keynote 而不是 debug toolbar

3. Capability Strip
- 第二屏不再讲 Owner / Agent / Provider 角色关系
- 改成 3 条协议能力声明：Discover / Pay / Invoke
- 每条只保留一个能力词和一句解释，不再做角色教育
- 整体更像协议能力说明，而不是 SaaS feature 卡片墙

4. Machine Commerce Flow
- Fund Vault
- Issue Agent Credentials
- Discover + Invoke Paid APIs
- Settle + Withdraw
- 第二屏不使用普通等宽功能卡墙，而是采用 narrative rail / editorial split layout
- 左右交错讲流程，旁侧插入能力注释，让页面像讲一条基础设施链路，而不是卖 7 个 feature

5. Registered Services
- 首页不再承担 registry preview 的证明职责，首页保持为 hero + capability strip + closing CTA 的极简结构
- 首页 proof 改由 live network stats 承担，不再恢复 registry preview
- 完整服务浏览统一承接到独立 `API Marketplace` 页面
- Marketplace 页面负责展示全量注册服务，并提供 search、tag filter、active/all 切换与复制 serviceId/endpoint 的操作
- 视觉形态采用 machine-readable registry terminal，而不是 marketing card grid
- Marketplace registry 允许极弱 live feed 动效：仅限 row 错峰信号起伏，不允许赛博扫屏、闪烁地图或高频粒子
- 当 registry 轮询发现某条 service 的 `updatedAt / health / runtime status / pricing / endpoint / summary` 发生变化时，允许对该条目触发一次性 entering highlight，模拟真实索引流的“新变更进入”反馈
- Marketplace 必须提供稳定的 machine-readable JSON export 入口，建议暴露为独立 URL，并继承当前页面过滤参数（`status / tag / q`），方便 agent 与开发者直接消费注册表

## 3. 导航交互规范

顶部导航采用玻璃胶囊形态，并提供以下交互：

- Active 高亮：当前页面保持文字高亮
- Liquid Slider：active 背景滑块平滑移动
- Hover Follow：鼠标划过时滑块跟随目标项
- Return to Active：移出后回归 active 项
- Press Feedback：点击时 0.98 轻微按压反馈
- 品牌器件感：logo 使用微型精密 monogram，状态胶囊和语言切换器都要像统一工业件，而不是散装按钮

动效标准：
- 滑块主过渡：150ms + cubic-bezier(0.22, 1, 0.36, 1)
- Glow 衰减：进入 120ms，退出 180ms

## 4. 多语言功能设计

已从页面局部实现升级为全局 i18n：

- Config: frontend/src/i18n/config.ts
- Schema: frontend/src/i18n/schema.ts
- Resources: frontend/src/i18n/resources/en.ts, zh.ts
- Translator: frontend/src/i18n/translate.ts
- Runtime Provider: frontend/src/components/i18n/LanguageProvider.tsx
- Switcher: frontend/src/components/i18n/LanguageSwitcher.tsx

关键机制：

- 默认英文，可切换中英文
- localStorage 持久化语言
- storage 事件同步多标签页语言状态
- 文案缺失 fallback 到默认语言
- 自动设置 html lang

## 5. 服务列表功能设计

来源：
- discoverServices() 公共发现接口

展示策略：
- 首页最多展示 8 个 active 服务
- 展示加载态与空状态
- 卡片中保留最关键调用信息

失败降级：
- 请求失败不阻塞首页主流程
- 列表降级为空状态文案

## 5.1 首页公共网络摘要（Live Network Stats）

来源：
- `GET /api/v1/services/network-stats`

字段：
- `registeredServices`
- `discoverableServices`
- `staleServices`
- `runtimeReadyServices`
- `totalCalls`
- `connectedAgents`

展示策略：
- 首页主展示仍显示 `API calls / registered services / connected agents`，但 `registered services` 必须取真正注册中的 active 服务数，而不是 discoverable 子集
- 如后续扩展 tooltip / 二级说明，优先使用 `discoverableServices` 与 `staleServices` 做运行态分层解释，避免把 catalog 规模和 runtime 可发现性混成一个数字
- 数字在客户端做短时 count-up，形成动态变化感
- 轮询节奏保持低频，避免首页变成 noisy dashboard
- 视觉形式保持轻量，不使用厚重 dashboard 卡片语言

失败降级：
- stats 接口失败时，回退到 discoverServices 的服务数
- 调用数与 agent 数回落为 0，不伪造金融级数据口径

## 6. 可维护性约束

1. 新页面禁止定义本地 COPY 常量
- 统一通过 t("namespace.key") / tList("namespace.key")

2. 新语言扩展规则
- 新增 resources/<lang>.ts
- 注册 resources/index.ts
- 补齐 schema 对应字段

3. 导航交互一致性
- 所有 marketing 页面共享同一顶部导航交互模型

## 7. 当前代码落点

- frontend/src/components/Navbar.tsx
- frontend/src/app/page.tsx
- frontend/src/app/marketplace/page.tsx
- frontend/src/app/blog/page.tsx
- frontend/src/app/about/page.tsx
- frontend/src/components/ServiceRegistryFeed.tsx
- frontend/src/components/i18n/LanguageProvider.tsx
- frontend/src/components/i18n/LanguageSwitcher.tsx
- frontend/src/i18n/config.ts
- frontend/src/i18n/schema.ts
- frontend/src/i18n/resources/en.ts
- frontend/src/i18n/resources/zh.ts
- frontend/src/i18n/translate.ts

## 8. 后续功能迭代建议

1. 增加 machine-readable 服务目录导出（JSON feed）
2. 支持更多 registry 过滤维度（runtime status / auth type / protocol）
3. 将导航液态滑块抽象为可复用组件
