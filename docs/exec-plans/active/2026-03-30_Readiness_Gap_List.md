# Readiness Gap List

## 0. Metadata

- Status: active
- Owner: Alex / Synapse founding team
- Date: 2026-03-30
- Related systems: `Synapse-Network`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Week1_Today_Checklist.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_Execution_Boards.md`
  - `docs/exec-plans/active/2026-03-30_Synapse_12_Week_Execution_Plan.md`
  - `docs/exec-plans/active/2026-03-30_Hero_Demo_Runbook.md`
  - `docs/exec-plans/active/2026-03-30_Public_Environment_Status_Register.md`
  - `docs/exec-plans/active/2026-03-30_Provider_Shelf_Status_Table.md`

## 1. Purpose

把 Week 1 要求的三张审计表压成一份可排序的 readiness 清单，直接回答：

1. 哪些东西已经有代码和文档骨架
2. 哪些东西还只是口号
3. 这周先打哪几个点

## 2. Public Environment Status

| Surface | Status | Repo evidence | Gap |
| --- | --- | --- | --- |
| `frontend` | `partial` | `apps/frontend/` 存在，且前端已支持 `sepolia / baseSepolia / arbitrumSepolia` | 已有状态登记表，仍缺公网部署地址与 demo URL |
| `gateway` | `partial` | `gateway/` 运行时、discover / quote / invoke 主链路已存在 | 已有状态登记表，仍缺公网 demo 环境确认 |
| `provider_service` | `partial` | `provider_service/` 已有多个 provider endpoints | 已有状态登记表，仍缺公网演示入口与对外稳定地址 |
| `database` | `partial` | Postgres init tree、provider-side schema、runbook 已存在 | 已有状态登记表，仍缺“当前 demo 环境数据库已在线”证明 |
| `contract` | `partial` | `contracts/` 存在，前端已配置测试链 | 已有状态登记表，仍缺已部署测试网合约地址登记 |
| `domain` | `partial` | 已新增 `Public_Environment_Status_Register` 作为登记入口 | 缺 demo 域名 / route 清单真实值 |
| `testnet` | `partial` | 文档多处以 `Arbitrum Sepolia` / `Base Sepolia` 为目标 | 已有状态登记表，仍缺“当前选用哪条链、地址是多少”的正式登记 |

## 3. Provider Shelf Status

目标样板服务以 Product Board 的 `Now` 为准。

| Service | Discover | Invoke | Pricing | Demo response | Notes |
| --- | --- | --- | --- | --- | --- |
| `web3 sentiment` | `partial` | `ready` | `partial` | `ready` | 已有独立 shelf table；endpoint 与文档齐，是否已进入 gateway discover 还需核实 |
| `smart contract audit` | `partial` | `ready` | `partial` | `ready` | 已有独立 shelf table；runtime 与 tests 存在，discover 和对外定价仍需收口 |
| `whale-flow-monitor` | `partial` | `ready` | `partial` | `ready` | 已有独立 shelf table；invoke 已有，需补对外货架表达 |

判定规则：

1. `ready`：仓库已有 endpoint + schema/tests 或明确对外契约
2. `partial`：仓库已有一半事实，但缺 discover 接入、价格、公开展示或演示路径
3. `missing`：仓库和 docs 都没有稳定落点

## 4. SDK / MCP / Demo Readiness

| Item | Status | Repo evidence | Gap |
| --- | --- | --- | --- |
| `Python SDK Quickstart` | `partial` | `sdk/python/`, `sdk/python/synapse_client/`, `gateway/examples/synapse_client_quickstart.py` | 缺面向外部开发者的最短接入闭环证明 |
| `MCP skeleton` | `missing` | 当前只见文档和前端文案提到 MCP，未见独立实现入口 | 需要最小可用 server/adapter |
| `Hero Demo script` | `partial` | 已有 `2026-03-30_Hero_Demo_Runbook.md` 首版 runbook | 缺真实命令、真实 credential、真实录屏链接 |
| `three-role isolation` | `missing` | 文档要求存在，但仓库未见正式演练记录 | 需要买家/卖家/平台三角色操作记录 |
| `demo video` | `missing` | 仓库未见 demo video 产物或登记 | 需要录屏 V1 和备用录屏 |

## 5. P0 This Week

这一周必须优先打掉：

1. 确认 demo 用测试链和合约地址
2. 形成公网环境状态表并确认哪些服务已经有公共访问入口
3. 把 `web3 sentiment / smart contract audit / whale-flow-monitor` 三个服务从货架表推进到真实 discover + pricing
4. 把 `Hero Demo` runbook 填成真实命令、真实角色和录屏链接
5. 明确 `MCP` 当前是 `missing`，不要继续把它当“好像已经有”

## 6. P1 Next Two Weeks

1. Python SDK Quickstart 对外化
2. MCP MVP 起骨架
3. 三角色隔离演练
4. demo video V1
5. provider discoverability 和定价策略收口

## 7. Not Now

1. TypeScript SDK
2. 多链扩张
3. 更重的 usage analytics 美化
4. 新的第四产品

## 8. Tomorrow Top 3

如果按当前差距排明天 Top 3，建议是：

1. 给 `Hero Demo runbook` 补真实命令和录屏入口
2. 给 `公网环境 / testnet / domain` 现状表填真实 URL 与链上地址
3. 给 `三服务货架状态表` 补真实 discover 结果和定价卡

## 9. Validation Log

### 2026-03-30

- Check: 对照 `Week1_Today_Checklist`、`Synapse_Execution_Boards` 与仓库代码路径
- Result: 已形成首版 readiness 审计与优先级清单
- Follow-up: `Hero Demo runbook`、`Public Environment Status Register` 和 `Provider Shelf Status Table` 已补首版，后续进入 `ready` 的项应继续把状态从 `partial/missing` 更新掉
