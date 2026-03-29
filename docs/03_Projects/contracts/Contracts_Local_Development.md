# Contracts Local Development

`contracts/` 承载 Synapse 的链上金库合约源码。

当前核心文件：

1. `SynapseCore.sol`
2. `MockUSDC.sol`

## 目录职责

这里负责：

1. 链上充值担保入口。
2. Permit / 签名提现相关最小链上约束。
3. 本地 Hardhat 编译与测试基座。

这里不负责：

1. 高频扣费。
2. Gateway 运行时协议。
3. 后台控制面。
4. Provider 独立服务逻辑。

## 本地编译

在仓库根目录执行：

```bash
cd /Users/cliff/workspace/Synapse-Network
npm install
npx hardhat compile
```

## 本地测试

在仓库根目录执行：

```bash
cd /Users/cliff/workspace/Synapse-Network
npx hardhat test
```

## 常用脚本

仓库根目录的 `scripts/` 下保留了合约相关辅助脚本，例如：

1. `scripts/deploy_anvil.js`
2. `scripts/fund_eth.js`
3. `scripts/fund_usdc.js`
4. `scripts/check_balance.js`

## 相关文档

1. [README.md](./README.md)
2. [../../02_System_Architecture/01_System_Topology_and_Request_Routing.md](../../02_System_Architecture/01_System_Topology_and_Request_Routing.md)
3. [../../03_Core_Workflows/01_Deposit_and_Idempotency.md](../../03_Core_Workflows/01_Deposit_and_Idempotency.md)
4. [../../03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md](../../03_Core_Workflows/05_Withdrawal_and_Risk_Gates.md)
5. [../../04_Database_Design/01_SQL_Schema_Overview.md](../../04_Database_Design/01_SQL_Schema_Overview.md)