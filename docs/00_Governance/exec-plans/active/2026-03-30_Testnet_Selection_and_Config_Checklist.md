# Testnet Selection And Config Checklist

## 0. Metadata

- Status: active
- Owner: Founder / CTO hat
- Date: 2026-03-30
- Related systems: `apps/frontend`, `gateway`, `provider_service`, `contracts`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Public_Environment_Status_Register.md`
  - `docs/exec-plans/active/2026-03-30_Public_Deployment_Checklist.md`
  - `docs/03_Projects/gateway/Gateway_Local_Development.md`
  - `docs/exec-plans/active/2026-03-30_Hero_Demo_Runbook.md`

## 1. Recommendation

当前推荐测试网：

1. `Arbitrum Sepolia`

备选：

1. `Base Sepolia`

## 2. Why This Recommendation

推荐 `Arbitrum Sepolia` 的原因不是情怀，而是迁移阻力最低：

1. 仓库当前默认 payout chain 已经偏向 `421614`
2. Hero Demo runbook 里优先链就是 `Arbitrum Sepolia`
3. 三服务注册脚本默认 `SYNAPSE_PAYOUT_CHAIN_ID=421614`
4. 前端已经内建支持 `arbitrumSepolia`

`Base Sepolia` 作为备选的优点：

1. 官方公开 RPC 明确
2. 官方 faucet 生态更完整
3. 钱包接入说明更直接

## 3. Repo Reality Check

如果你切到 `Arbitrum Sepolia` 或 `Base Sepolia`，多数是改配置，不是重写代码。

但不是 `100%` 零代码：

1. 前端 `QuickStartGuide` 之前把 permit domain `chainId` 写死为 `1`
2. 这个坑本轮已修，现会跟随当前钱包网络
3. 如果未来切到这三条之外的新测试网，还要补前端链配置和链标签

当前前端已内建支持：

1. `Sepolia`
2. `Base Sepolia`
3. `Arbitrum Sepolia`

## 4. Config Change Checklist

### 4.1 Contracts

- [ ] 把 `MockUSDC`
- [ ] 把 `SynapseCore`
- [ ] 如有变化，补 `Treasury`
- [ ] 更新 [contract-config.json](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/contract-config.json)
- [ ] 如需快速起手，先从 [contract-config.arbitrum-sepolia.example.json](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/contract-config.arbitrum-sepolia.example.json) 复制

### 4.2 Frontend

- [ ] 确认钱包目标网络切到推荐测试网
- [ ] `NEXT_PUBLIC_GATEWAY_BASE_URL` 指向公网 `gateway`
- [ ] 若切到 `Arbitrum Sepolia / Base Sepolia / Sepolia` 之外的新链，补 `Providers.tsx` 链配置
- [ ] 若切到新链，补 `ProviderSettlementsPage.tsx` 的链标签映射

### 4.3 Gateway

- [ ] `RPC_URL` 指向目标测试网
- [ ] `ROUTER_ADDRESS` 替换成目标测试网地址
- [ ] `USDC_TOKEN_ADDRESS` 替换成目标测试网地址
- [ ] `PRIVATE_KEY` 对应目标测试网可用 signer
- [ ] `INDEXER_ADMIN_WALLETS` 配置好
- [ ] `PLATFORM_FEE_ADMIN_WALLETS` 配置好

### 4.4 Provider Shelf / Registry

- [ ] `SYNAPSE_PAYOUT_CHAIN_ID` 改成目标测试网 chain id
- [ ] 如切换部署域名，重新注册 provider service targets
- [ ] 重新验证 `discover -> quote -> invoke`

## 5. Chain IDs To Use

建议直接用这组值：

1. `Arbitrum Sepolia`: `421614`
2. `Base Sepolia`: `84532`
3. `Sepolia`: `11155111`

## 6. Go / No-Go

只有满足下面 5 条，才算切网成功：

1. 前端钱包能切到目标测试网
2. deposit / permit 不再报链 ID 错误
3. `gateway` 能连到目标测试网 RPC
4. provider payout `chainId` 与目标链一致
5. 至少一条 `discover -> quote -> invoke` 重新成功

## 7. Validation Log

### 2026-03-30

- Check: 对照仓库默认链配置、Hero Demo runbook、前端链支持与 provider payout 默认值
- Result: 推荐当前先锁定 `Arbitrum Sepolia`，`Base Sepolia` 作为公网友好备选
- Follow-up: 下一步把真实测试网合约地址和 explorer 链接回填进 `Public_Environment_Status_Register`
