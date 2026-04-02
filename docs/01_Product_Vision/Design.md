# Synapse Frontend Design Baseline

## 定位

Synapse 的前端设计不是营销装饰层，而是基础设施可信度的可视化界面。

设计目标只有三件事：

- 让用户一眼感知“这是金融级基础设施”
- 让开发者在复杂链路中保持低认知负担
- 让交互反馈精准、克制、可预期

## 设计品味基调（Taste Baseline）

采用 Apple Pro + Dev-Luxury 的混合基调：

- 95% 极简黑白灰（克制、专业、可信）
- 5% 荧光信号色（状态、资金流、执行成功）

拒绝两个极端：

- 纯消费级白底 SaaS（缺少基础设施厚重感）
- 满屏霓虹黑客风（可读性与信任感受损）

## 视觉系统（Visual System）

1. 背景与层次
- 主背景：深空黑（接近 #000000）
- 结构层：极深灰（如 #0a0a0a）
- 边界层：细金属线边框（如 #222222）

2. 文本系统
- 主标题：高对比白
- 正文说明：钛灰注释（如 #86868b）
- 导航与关键文案：确保可读优先，避免过细字重

3. 信号色策略
- 荧光绿只用于状态与资金流信号
- 不作为大面积背景色使用

4. Typography Scale
- 页面不能继续混用大量 `text-[11px]`、`text-[13px]`、`text-[15px]`、`text-[2rem]` 这类局部硬编码字号
- 统一通过共享 typography token 输出层级，当前基线包括：`x-page-title`、`x-section-title`、`x-card-title`、`x-body-copy`、`x-meta-label`、`x-action-label`、`x-overline-label`、`x-data-label`、`x-metric-value`、`x-modal-title`
- 页面标题、分区标题、正文、按钮文案、标签、数据值必须落到固定语义层级，不能按单个组件临时拍脑袋定字号
- 需要例外字号时，先补 token，再落实现，不允许直接继续扩散任意 `text-[Npx]`

### X Desktop Reference

Agents workspace 的 typography 基线以 X 桌面 Apps / API keys 页面为参考，不是照搬它的私有字体文件，而是提取它的字号层级关系。

1440px 桌面 viewport 下的目标参考值：

1. 页面主标题：34px，约占 viewport 宽度的 2.36%
2. 详情实体标题：32px，约占 viewport 宽度的 2.22%
3. 面板标题：24px，约占 viewport 宽度的 1.67%
4. Modal 标题：26px，约占 viewport 宽度的 1.81%
5. 卡片标题：18px，约占 viewport 宽度的 1.25%
6. 正文与按钮文案：15px，约占 viewport 宽度的 1.04%
7. Meta / 数据标签：13px，约占 viewport 宽度的 0.90%
8. Overline / 全大写辅助标签：11px 到 12px，约占 viewport 宽度的 0.76% 到 0.83%
9. KPI / Token Prefix / 关键数值：26px 到 29px，约占 viewport 宽度的 1.81% 到 2.01%

5. Responsive Type Strategy
- 字号缩放一律使用 `rem + clamp()`，而不是纯 `vw` 或按设备分辨率写死像素
- `clamp(min, fluid, max)` 只允许温和参与 viewport 宽度，确保大屏不失控、小屏不挤爆
- 字号比例依赖语义层级和容器宽度，不依赖物理屏幕分辨率；真正影响排版的是 CSS viewport，不是显示器标称 2K / 4K
- 版心宽度必须有上限，例如 workspace 主容器的 `max-width`，否则文字会在超宽屏上显得过小
- 数据大数字和标题可以参与更明显的 fluid scaling，正文和标签只允许极弱缩放，保证可读性稳定

6. Current Baseline
- Page title: `x-page-title`，用于页面主标题
- Detail title: `x-detail-title`，用于详情页实体标题
- Section title: `x-section-title`，用于模块标题和详情页内部区块标题
- Modal title: `x-modal-title`，用于 create / danger / success / edit dialog 的标题
- Body copy: `x-body-copy`，用于说明文案
- Action label: `x-action-label`，用于主要按钮、次级按钮、工具动作
- Overline/meta: `x-overline-label` 与 `x-meta-label`，用于全大写标签、辅助标注
- Metric value: `x-metric-value`，用于预算、额度、token prefix 等高权重数字信息

7. Constraint Rules
- `x-page-title` 只能用于页面一级标题，不允许拿去做卡片标题
- `x-detail-title` 只用于右侧详情头部实体名这类高权重标题
- `x-section-title` 只用于面板和内容分区标题，不允许冒充页面标题
- `x-body-copy` 与 `x-action-label` 默认锁定在 15px 基线附近，只允许非常轻微的 fluid scaling
- `x-meta-label` / `x-overline-label` 必须保持比正文至少低一个层级，不允许和正文同号
- `x-metric-value` 只能用于高权重数值或 token prefix，不允许泛滥到普通文案

## 交互美学原则（Interaction Aesthetics）

1. 动效是功能，不是装饰
- 动效必须服务于“状态切换”和“焦点引导”
- 避免无意义跳动和过度弹跳

2. 微动效规范
- 过渡时长短且稳定（以 100ms ~ 180ms 为主）
- 动效曲线优先自然缓动（如 cubic-bezier）
- 点击反馈要有触感（轻微缩放即可）

3. 信息密度控制
- 在首屏聚焦核心叙事，减少干扰项
- 卡片层级清晰，避免花哨阴影堆叠

## 设计原则（Design Principles）

1. Credibility First
- 金融结算类产品优先建立“可信”而非“炫酷”

2. Clarity Over Decoration
- 一切视觉决策都应提升可读性与决策效率

3. Consistency Across Pages
- 导航、按钮、状态、反馈在全站一致

4. Minimal but Alive
- 整体克制，但在关键状态上有生命感

5. Accessibility Matters
- 字重、对比、可点击区域必须保证可用性
- 字号系统要保证在 390px 级移动端、1440px 常规桌面、1920px 宽屏下都维持相同层级关系，而不是每个断点重新发明一套比例

## Modal / Dialog System

前端所有业务弹窗必须使用同一套 modal token，不允许页面私自定义一套新的圆角、遮罩、头部高度或关闭按钮尺寸。

1. Centering & Overlay
- 统一使用 `x-dialog-shell` + `x-modal-overlay`
- 所有弹窗默认全局水平居中、垂直居中
- 不允许出现页面局部偏移、顶部吸附、或只靠局部容器居中的实现

2. Surface Token
- 统一使用 `x-modal-flat` + `x-modal-surface`
- 标准圆角固定为 `28px`
- surface 默认 `overflow: hidden`，由 token 负责边框和基础层次

3. Header Token
- 统一使用 `x-modal-header`
- header 最小高度固定为 `80px`
- 标题、副标题、关闭按钮必须在同一条 header 语义层内组织

4. Close Button Token
- 统一使用 `x-modal-close`
- 关闭按钮命中区域固定为 `40px × 40px`
- 不允许在业务组件内再次写一套 `p-2` / `rounded-lg` / 自定义 hover 来破坏一致性

5. Body & Footer Token
- 内容区统一使用 `x-modal-body`
- 底部动作区统一使用 `x-modal-footer` 或 `x-modal-action*`
- 高风险确认、生成、保存动作的按钮尺寸必须稳定，不能因文案或页面不同而漂移

6. Governance
- 页面需要例外样式时，先更新本设计基线，再改实现
- 新增 modal 时，先复用 token，再考虑业务特例
- 任何新增的一次性 modal 样式都视为设计债务

## X Primitive Component Layer

从 2026-04-01 开始，Synapse 的 X 风格控制台不再只停留在 CSS token 层，必须落到真实 React 原语组件。

### 从 X Console 页面可抽取的稳定对象

1. pill / ghost / danger / icon buttons
2. dialog overlay / surface / header / footer
3. dark inputs
4. flat / muted / tile / active panels
5. status pills
6. empty states
7. inspector panes

### 本轮已经正式收口的原语

1. `XButton`
2. `XDialog`
3. `XInput`
4. `XPanel`

代码入口在：

1. `apps/frontend/src/components/xui/XButton.tsx`
2. `apps/frontend/src/components/xui/XDialog.tsx`
3. `apps/frontend/src/components/xui/XInput.tsx`
4. `apps/frontend/src/components/xui/XPanel.tsx`

### 强约束

1. 业务页不再允许直接手写 `x-button-*` 代替 `XButton`
2. 业务页不再允许直接手写 `x-modal-*` 结构代替 `XDialog`
3. 业务页不再允许直接手写 `x-input-flat` 代替 `XInput`
4. 业务页不再允许直接手写 `x-panel-*` 代替 `XPanel`
5. 页面需要例外样式时，先补原语，再落业务页

详细组件治理看：

1. `docs/01_Product_Frontend/05_X_Component_System_Contract.md`

## 页面审美执行清单

每次前端页面改版前，先检查以下五项：

1. 颜色是否遵守“95/5”策略
2. 标题与导航是否清晰可读（尤其字重）
3. 状态反馈是否清楚且不过度
4. 视觉层次是否简洁且一致
5. 设计是否强化“基础设施可信度”

## 范围声明

本文件只定义设计基调、视觉品味与交互原则。

功能性设计（导航结构、i18n 架构、服务列表能力、页面功能拆分）已迁移至：

- doc/feature_designs/frontend_product/Homepage_V2_Functional_Design.md
