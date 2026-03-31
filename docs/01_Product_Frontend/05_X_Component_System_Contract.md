# X Component System Contract

- Status: supplementary
- Code paths: `apps/frontend/src/components/xui/`, `apps/frontend/src/components/dashboard-workspace/DashboardAgentsPage.tsx`
- Verified with: `yarn build`, `npm run ci:docs`
- Last verified against code: 2026-03-31

## 1. 为什么现在必须抽组件层

Synapse 当前已经有一套 `x-*` 视觉 token，但还停留在 CSS class 层。

如果继续在页面里直接手写：

1. `x-button-primary + px-5 + rounded-full + ...`
2. `x-modal-flat + x-modal-surface + x-modal-header + ...`
3. `x-panel-muted + rounded-[20px] + p-5`

最后结果一定是：

1. 页面各自拼装，设计语言裂开
2. X Console 风格只停留在截图临摹，不会变成可维护系统
3. 后续页面继续复制粘贴，设计债务指数级增长

所以从 2026-04-01 开始，`apps/frontend` 的 X 风格控制台必须通过真实 React 原语落地，而不是继续只靠 class 组合。

## 2. 从 X 页面里能抽出的稳定原语

基于 Apps、Usage、Credits、Payments 等页面，可稳定抽出下面这些对象：

1. `x-button`
2. `x-dialog`
3. `x-input`
4. `x-panel`
5. `x-status-pill`
6. `x-page-header`
7. `x-empty-state`
8. `x-inspector-pane`

本轮先把最底层四个原语正式收口：

1. `XButton`
2. `XDialog`
3. `XInput`
4. `XPanel`

其余对象必须建立在这四个之上，不允许跳过原语直接页面手搓。

## 3. 当前代码真理源

### 3.1 Component Entry

1. `apps/frontend/src/components/xui/XButton.tsx`
2. `apps/frontend/src/components/xui/XDialog.tsx`
3. `apps/frontend/src/components/xui/XInput.tsx`
4. `apps/frontend/src/components/xui/XPanel.tsx`

### 3.2 First Rollout Page

1. `apps/frontend/src/components/dashboard-workspace/DashboardAgentsPage.tsx`

Agents 页是第一块样板地。后续 Credits、Payments、Usage、Provider Workspace 要沿同一套原语迁移，不允许各自开新体系。

## 4. 原语职责边界

### 4.1 `XButton`

负责：

1. 主 CTA
2. 次级 ghost CTA
3. 危险操作 CTA
4. icon-only action
5. modal action / credential action 的尺寸基线

不负责：

1. 页面局部临时配色
2. 单个业务页自定义圆角
3. 为了凑布局临时写一套新按钮

### 4.2 `XDialog`

负责：

1. overlay
2. surface
3. header
4. close button
5. body
6. footer
7. portal / z-index / center layout

不负责：

1. 每个业务页自定义遮罩强度
2. 页面里直接复制 modal DOM 结构

### 4.3 `XInput`

负责：

1. text / number / datetime-local 等标准输入框的底层外观
2. placeholder、focus、readOnly 的统一行为

不负责：

1. 单页专用输入样式
2. 业务表单布局

### 4.4 `XPanel`

负责：

1. flat surface
2. muted surface
3. tile surface
4. active tile
5. interactive tile

不负责：

1. 页面网格布局
2. 图表内容
3. 业务语义本身

## 5. 强约束

从现在开始，下面这些做法属于违规：

1. 在业务页直接新写一套 modal header / close / footer DOM 结构
2. 在业务页直接组合 `x-button-*` class 代替 `XButton`
3. 在业务页直接组合 `x-input-flat` 代替 `XInput`
4. 在业务页直接组合 `x-panel-flat` / `x-panel-muted` 代替 `XPanel`
5. 为了赶进度在页面里复制另一页的按钮或弹窗结构

允许的例外只有一种：

1. 原语能力不够，先补原语，再落业务页

不允许的偷懒方式：

1. “这页先手写，后面再抽”

这类说法在 Synapse 前端里默认等于设计债务。

## 6. 页面作者该怎么写

正确顺序：

1. 先选原语
2. 再做布局
3. 最后加少量业务特定 className

错误顺序：

1. 先在页面里写完整 DOM 和样式
2. 发现重复后再考虑抽

## 7. 下一批迁移目标

优先级从高到低：

1. `DashboardCredentialsPage.tsx`
2. `OwnerCreditsPage.tsx`
3. `OwnerBillingPage.tsx`
4. `ProviderServicesPage.tsx`
5. `ProviderSecretsPage.tsx`

判断标准只有一个：

哪个页面还在大量手写 `x-modal-*`、`x-button-*`、`x-panel-*`，哪个页面就优先迁移。
