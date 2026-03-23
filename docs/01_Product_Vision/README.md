# Product Vision Map

本目录承载 Synapse 的商业定位、产品愿景、路线图与对外叙事。

它回答的是：

1. Synapse 为什么存在。
2. 我们要服务什么样的 Agent 经济。
3. 产品分阶段怎么落地。

它不负责定义 Runtime 协议、数据库字段、Gateway 执行细节。这些 canonical 定义统一回到 `docs/agent/`、`docs/06_Reference/05_Runtime_API_Contract.md` 和数据库文档。

## 推荐阅读顺序

1. [MVP.md](./MVP.md)
   当前最小可用产品边界。
2. [Monetization_Model.md](./Monetization_Model.md)
   平台收入模式与定价逻辑。
3. [Future_Plans.md](./Future_Plans.md)
   后续扩展方向。
4. [ROADMAP.md](./ROADMAP.md)
   分阶段路线图。
5. [Product_Thinking.md](./Product_Thinking.md)
   产品判断逻辑和设计思考。
6. [Business_Plan.md](./Business_Plan.md)
   更完整的商业叙事材料。
7. [Pitch_Deck_Material.md](./Pitch_Deck_Material.md)
   对外路演素材。
8. [slogan.md](./slogan.md)
   品牌语言与传播文案。
9. [../plan/项目计划.md](../plan/%E9%A1%B9%E7%9B%AE%E8%AE%A1%E5%88%92.md)
   legacy product-growth memo，保留历史增长战役与路演叙事草稿，不作为标准执行计划使用。

## 与其他目录的边界

1. 产品愿景与品牌表达：本目录。
2. Agent Runtime 与身份模型：`docs/agent/`。
3. 前端体验与页面 IA：`docs/01_Product_Frontend/` 与 `docs/feature_designs/frontend_product/`。
4. 充值、扣费、提现、结算：`docs/03_Core_Workflows/` 与 `docs/04_Database_Design/`。
5. Gateway 架构与生产安全：`docs/02_System_Architecture/` 与 `docs/05_DevOps_Deployment/`。
6. 多步骤执行计划：`docs/exec-plans/`；`docs/plan/项目计划.md` 仅保留为 legacy 产品策略记录。

## 维护规则

1. 本目录允许讨论商业和产品方向，但不能覆盖已经落地的 API/数据库事实。
2. 当商业叙事和当前代码实现不一致时，必须以 `docs/agent/`、`docs/06_Reference/05_Runtime_API_Contract.md` 和数据库文档为准，再反向修正文案。