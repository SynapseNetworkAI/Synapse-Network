# A2A-pay 测试指南

## 1. 启动区块链环境
```bash
cd /Users/cliff/workspace/A2A-pay
npx hardhat node
```

## 2. 部署基础合约
打开新终端:
```bash
npx hardhat run scripts/deploy.js --network localhost
```

## 3. 为测试钱包账户充值

### 3.1 增加基础 Gas 费 (ETH)
```bash
npx hardhat run scripts/fund.js --network localhost
```

### 3.2 增加业务代币 (USDC)
```bash
npx hardhat run scripts/fund_usdc.js --network localhost
```

## 4. 全局核心测试流
```bash
npx hardhat test
```
