# contracts

## 1. 项目定位

`contracts/` 承载 Synapse 的链上金库合约与本地链路测试合约。

它负责：

1. USDC 充值担保入口
2. EIP-712 / Permit / 提现签名相关链上约束
3. 本地和测试环境的合约编译、部署与验证基础

一句话：这里定义的是链上最终清算边界，而不是高频记账逻辑。

## 2. 代码位置

- 合约目录：`contracts/`
- 当前核心文件：`contracts/SynapseCore.sol`
- 测试代币：`contracts/MockUSDC.sol`
- 编译配置：`hardhat.config.js`

## 3. 职责边界

`contracts/` 应该承担：

1. 最小链上资产保管与凭票提现验证
2. 只保留必须上链的资产真相与签名验证逻辑

`contracts/` 不应该承担：

1. 高频扣费
2. Runtime discovery / quote / invoke
3. 后台审批与运营治理
4. 复杂链下预算和限流判断

## 4. 直接依赖关系

1. 被 `gateway/` 用作链上充值、提现、对账的合约基座
2. 被 `docker-compose/` 与本地脚本配合用于测试环境部署
3. 被文档中的资金流、提现票据和结算模型引用

## 5. Canonical 文档入口

1. `docs/02_System_Architecture/01_System_Topology_and_Request_Routing.md`
2. `docs/03_Core_Workflows/01_Deposit_and_Idempotency.md`
3. `docs/03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md`
4. `docs/Gateway_Database_Design.md`
5. `docs/agent/06_Build_For_Agent_Database_Rebuild.md`

## 6. 项目内建议补齐

根 `docs/03_Projects/contracts/` 当前集中维护：

1. [Contracts_Local_Development.md](./Contracts_Local_Development.md)

项目目录内只保留最小入口文档：

1. `contracts/README.md`
2. 如未来出现稳定、独立、长期维护的 contracts-only 工程规则，再评估是否需要 `contracts/AGENTS.md`

当前推荐先读本页，再进入 [Contracts_Local_Development.md](./Contracts_Local_Development.md) 看编译与测试说明。

当前结论：`contracts/` 暂不新增独立 `AGENTS.md`。原因是当前约束主要已经由仓库总规范、合约本地开发说明和系统级 canonical 文档覆盖；为了形式统一新增空规则文件没有收益。