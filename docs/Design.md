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
