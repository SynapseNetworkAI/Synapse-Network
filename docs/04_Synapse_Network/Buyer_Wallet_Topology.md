# 买家端架构设计：钱包与API Key的拓扑关系与资金管理

## 1. 核心设计：一对多（1 Wallet -> N API Keys -> 1 Fund）

在 Synapse Network 平台中，买家的钱包（Wallet）与 API Key 的关系设计为**一对多**。
充值担保（Deposit）是**直接挂载在主钱包地址**上的，所有由该钱包签发的 API Keys **共享同一个资金池**。而每个 API Key 则作为一个**独立的调用凭据（Credential）**。

也就是说：
- **资金（Deposit / 余额）公用**：主钱包统一进行链上充值（Deposit），这笔资金形成了该钱包维度的总可用余额。
- **凭据与调用（Credential）独立**：主钱包可以为不同的开发环境、不同的项目、或者不同的实例签发多个独立的 `API Key`。
- **账单聚合出账**：各个 API Key 所产生的 API 调用账单，最终都会统一在其主钱包的余额池中扣抵。

### 1.1 架构模型图

```mermaid
graph TD
    W[Buyer主钱包 EOA: 0x12..] -->|链上充值 Deposit| P[平台账户余额池]
    
    W -->|签发| K1[API Key A (测试环境)]
    W -->|签发| K2[API Key B (生产应用1)]
    W -->|签发| K3[API Key C (生产应用2)]
    
    P -.->|总预分配额度| K1
    P -.->|总预分配额度| K2
    P -.->|总预分配额度| K3
    
    K1 -->|调用 AI API - 扣减主余额| S1[Seller API]
    K2 -->|调用 AI API - 扣减主余额| S1
    K3 -->|调用 其他 API - 扣减主余额| S2[Seller API]
```

## 2. 为什么这样设计？（设计动机）

如果设计成“每个任务一个独立钱包，充值和凭据绑定在不同钱包上”，会导致：
1. **资金碎片化**：用户跑3个不同的应用，就要往 3 个钱包里分别打 Gas 和充值 USDC，体验极差。
2. **私钥风险**：如果把控制资金的主私钥/助记词直接放进代码里去调用接口，一旦服务器被黑，黑客不仅能发请求，还能把底层的链上资金直接全部转走。

**当前的“一对多（共享资金池、独立 API Key）”设计的优势：**

1. **资金安全隔离**：用户只需使用安全的 MetaMask 等钱包前端签写链上合约，完成大额充值（Deposit），资金处于平台智能合约的安全锁仓中。代码中绝对不需要暴露钱包私钥。
2. **细粒度的权限撤销**：用户可以放心地把 `API Key A` 交给云服务器A，把 `API Key B` 交给服务器B。如果 B 的服务器配置泄露，主钱包点一下“吊销 API Key B”即可，黑客无法继续调用，且绝对无法逆向盗取主钱包里的本金。
3. **资金利用率最大化**：充值的 100 USDC 动态共享给所有 API Keys。永远不会出现 A 没钱报错而 B 却闲置 50 USDC 的情况。

---

## 3. UI 页面交互设计 (Developer Console)

基于上述架构，在 `Developer Console` 空间中的信息流向和 UI 设计如下：

### 3.1 页面操作流
为了更好的获客体验与平台透明度，控制台采用**访客可预览模式（Unauthenticated Preview）**：
- **未连接状态下的可展示性 (Wallet-Free Visibility)**：用户在**不需要连接钱包**的情况下也可以访问 `Developer Console` 的绝大部分排版和框架（包括页面介绍、UI卡片结构、代码集成示例），以直观地感受到平台的能力与使用极简度，降低理解门槛。
- **操作强制拦截（Silent to Forced Auth）**：当用户在未登录状态下点击【Create Key】、【Add Funds】等实质性交互时，UI 将弹出全局提醒“Please connect your wallet first” 或唤醒登录弹窗。

整体操作流如下：
- **Step 1：预览与连接钱包 (Browse & Connect)**：以访客身份浏览控制台能力，随后主动点击右上角连接钱包。
- **Step 2：一键充值 (Add Funds/Faucet)**：钱包维度的全局操作，注入 USDC 余额。
- **Step 3：生成 API Key**：生成仅展示一次的秘钥。开发者即刻可以复制应用至 SDK。

### 3.2 充值担保流程 (Deposit)
这是**全局**操作。
- 页面：在 `My Balance` 卡片中。
- 操作：拉起 MetaMask 进行 `Permit` 签名或直接调用 Deposit，将 USDC 授权存入 Vault 合约。
- 状态：操作即刻生效，资金挂载于用户的 `ownerAddress`，全局生效。所有 API Keys 都能立刻花费这笔钱。

### 3.3 凭据与调用流程 (API Key)
这是**局部**操作。
- 页面：在 `API Keys` 卡片中。
- 操作：
  1. 用户点击【Create new secret key】。
  2. 系统生成具有相应权限配置的唯一 Token。
  3. UI 将展示生成的凭据，并提供快速复制到代码的示例（Quick Start）。
- 状态：即使一个 API Key 被撤销/删除，仅影响该秘钥的调用授权，该 Key 过去的消费记录继续留存，主钱包余额绝对安全且不直接受影响。

---

## 4. 后端/合约的逻辑映照

1. **Database**：
   - 账户余额表：主键为 `user_wallet_address`，核心字段 `available_balance`。
   - 凭据表：主键为 `credential_id`，字段包含 `owner_wallet_address`，`credential_token`，`status` (Active / Revoked) 等。

2. **鉴权与扣费原子流**（Gateway 层面）：
   - 请求头带上 `Authorization: Bearer <API Key>` (或自定 Header `X-Agent-Credential`)。
   - Gateway 校验：
     - 去库里/Redis查这把 `Key` 及其背后的 `owner_wallet_address`。
     - 若该 token 被吊销（Revoked / 未激活），拦截返回 401。
     - 拿着 `owner_wallet_address` 去余额表查 `available_balance`，如果发现余额不足调用扣减底线，拦截返回 402 Payment Required。
     - 若检查通过，放行请求至 Seller。请求结束后处理结账：`payer_address: owner_wallet`, `caller_credential: credential_id`，统一从 `owner_wallet` 扣除应付余额。

## 5. 结论总结

| 维度 | 操作层级 | 影响范围 | 设计原则 |
|---|---|---|---|
| **充值担保 (Deposit)** | 主钱包 (Wallet) 级别 | 全局 | **所有 API Key 公用一个充值担保资金池**。链上交互低频高额化，不泄露私钥。 |
| **凭据 (API Key)** | 开发/项目/实例级别 | 局部 | **支持多签发与随时吊销**。无缝兼容传统 Web2 开发者习惯。 |
