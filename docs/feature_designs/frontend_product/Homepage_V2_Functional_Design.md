# Homepage V2 功能设计（Functional Design)

## 1. 目标

Homepage V2 的功能目标不是展示炫技，而是形成可转化、可探索、可扩展的首页入口层：

- 一屏建立产品认知（是什么、解决什么问题）
- 提供清晰导航入口（Marketplace / Blog / About / Language）
- 提供可消费的服务发现能力（Registered Services）
- 支持中英文切换，形成全局 i18n 基础设施

## 2. 信息结构（IA）

1. 顶部导航（Global Navbar）
- Brand: Synapse Network
- Status: Gateway Node
- Links: API Marketplace / Blog / About
- Language: EN / ZH

2. Hero
- 主叙事标题（Settlement Layer）
- 副标题（Stripe for AI Agents）
- CTA（Buyer Access / Provider Console）

3. Problem / Solution
- 机器支付断层问题
- Synapse 解决方案

4. Registered Services
- 服务名
- serviceId
- endpoint
- pricing
- role

## 3. 导航交互规范

顶部导航采用玻璃胶囊形态，并提供以下交互：

- Active 高亮：当前页面保持文字高亮
- Liquid Slider：active 背景滑块平滑移动
- Hover Follow：鼠标划过时滑块跟随目标项
- Return to Active：移出后回归 active 项
- Press Feedback：点击时 0.98 轻微按压反馈

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
- frontend/src/app/blog/page.tsx
- frontend/src/app/about/page.tsx
- frontend/src/components/i18n/LanguageProvider.tsx
- frontend/src/components/i18n/LanguageSwitcher.tsx
- frontend/src/i18n/config.ts
- frontend/src/i18n/schema.ts
- frontend/src/i18n/resources/en.ts
- frontend/src/i18n/resources/zh.ts
- frontend/src/i18n/translate.ts

## 8. 后续功能迭代建议

1. Marketplace 增加搜索与 tag 过滤
2. Service 卡片增加复制 serviceId / endpoint
3. 增加 machine-readable 服务目录导出（JSON feed）
4. 将导航液态滑块抽象为可复用组件
