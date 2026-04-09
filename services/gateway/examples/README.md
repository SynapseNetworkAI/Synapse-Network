# Gateway Examples — 示例脚本说明

本目录包含 Synapse Gateway 的端到端示例脚本，演示从认证、服务发现、链上支付到 API 调用的完整链路。

## 前置条件

- Python 3.11+
- 依赖：`pip install requests eth-account web3`（部分脚本需要）
- 本地环境：Gateway 运行在 `http://127.0.0.1:8000`，Hardhat/Anvil 链运行在 `http://127.0.0.1:8545`

---

## 文件说明

### 1. `synapse_client_quickstart.py` — SDK 快速入门

**作用**：演示两种调用模式——硬编码 Service ID 直接调用，和通过语义发现（Semantic Discovery）自动匹配最优服务。

**环境变量**：

| 变量 | 必填 | 说明 |
|------|------|------|
| `SYNAPSE_API_KEY` | ✅ | Agent 凭据令牌，格式 `agt_...` |

**使用方式**：
```bash
export SYNAPSE_API_KEY='agt_...'
python synapse_client_quickstart.py
```

---

### 2. `agent_sdk_discover_invoke.py` — 服务发现 + 调用

**作用**：完整演示 Consumer 通过 Gateway 的「发现服务 → 选择最优 → 调用」链路。通过配置文件驱动，无需环境变量。

**配置文件**：`agent_sdk_discover_invoke.config.json`（同目录）

| 字段 | 说明 |
|------|------|
| `api_base` | Gateway API 地址，如 `http://127.0.0.1:8000` |
| `agent_credential_token` | Agent 凭据令牌（从 `/credentials/agent/issue` 获取） |
| `intent` | 语义搜索意图，如 `"名人名言"` |
| `prompt` | 调用服务时发送的提示词 |

**使用方式**：
```bash
# 1. 编辑 agent_sdk_discover_invoke.config.json 填入凭据和意图
# 2. 执行
python agent_sdk_discover_invoke.py
```

---

### 3. `credential_issue_invoke_revoke.py` — 凭据全生命周期

**作用**：演示 Agent Credential 的完整生命周期——签发 → 链上支付 → 调用服务 → 撤销凭据。包含 EIP-191 钱包签名登录和链上 Mint/Approve/Pay 全流程。

**环境变量**：

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `OWNER_PRIVATE_KEY` | ✅ | Owner 钱包私钥 | — |
| `SERVICE_ID` | ✅ | 要调用的服务 ID | — |
| `PROVIDER_ADDRESS` | ✅ | Provider 钱包地址 | — |
| `API_BASE` | | Gateway API 地址 | `http://127.0.0.1:8000` |
| `RPC_URL` | | 链 RPC 地址 | `http://127.0.0.1:8545` |
| `DEPLOYER_PRIVATE_KEY` | | 部署者私钥（用于 mint） | Hardhat #0 |
| `OWNER_PAYMENT_PRIVATE_KEY` | | 付款钱包私钥 | 同 `OWNER_PRIVATE_KEY` |
| `PRICE_USDC` | | 单次支付金额 | `1` |
| `PROMPT` | | 调用提示词 | `hello from credential script` |
| `EXPIRES_IN_SEC` | | 凭据有效期（秒） | `3600` |
| `MAX_CALLS` | | 凭据最大调用次数 | `100` |
| `RPM` | | 每分钟请求限制 | `600` |

**使用方式**：
```bash
export OWNER_PRIVATE_KEY=0x...
export SERVICE_ID=svc_xxx
export PROVIDER_ADDRESS=0x...
python credential_issue_invoke_revoke.py
```

---

### 4. `register_provider_shelf_services.py` — Provider 服务批量注册

**作用**：向 Gateway 批量注册多个 Provider 服务定义，包含完整的服务元数据（名称、定价、标签、请求/响应 Schema、约束、健康检查配置）。默认注册 3 个示例服务：

| 服务 | 定价 | 说明 |
|------|------|------|
| Web3 Sentiment Index | 0.01 USDC | 加密市场情绪指数 |
| Smart Contract Audit | 0.50 USDC | 智能合约安全审计 |
| Whale Flow Monitor | 0.10 USDC | 巨鲸钱包资金流监控 |

**环境变量**：

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `SYNAPSE_GATEWAY_API_BASE` | ✅ | Gateway API 地址 | — |
| `SYNAPSE_OWNER_ADDRESS` | ✅ | Owner 钱包地址 | — |
| `SYNAPSE_OWNER_BEARER_TOKEN` | ✅ | Owner JWT 令牌 | — |
| `SYNAPSE_PROVIDER_BASE_URL` | | Provider 服务基础 URL | `http://127.0.0.1:8100` |
| `SYNAPSE_PROVIDER_DISPLAY_NAME` | | Provider 显示名称 | `Synapse Labs` |
| `SYNAPSE_PAYOUT_ADDRESS` | | 收款地址 | 同 `OWNER_ADDRESS` |
| `SYNAPSE_PAYOUT_CHAIN_ID` | | 收款链 ID | `421614` (Arbitrum Sepolia) |
| `SYNAPSE_REGISTER_DRY_RUN` | | 设为 `true` 仅打印 payload | `false` |

**使用方式**：
```bash
export SYNAPSE_GATEWAY_API_BASE=http://127.0.0.1:8000
export SYNAPSE_OWNER_ADDRESS=0x...
export SYNAPSE_OWNER_BEARER_TOKEN=...
python register_provider_shelf_services.py

# Dry Run 模式（仅打印，不实际注册）
SYNAPSE_REGISTER_DRY_RUN=true python register_provider_shelf_services.py
```

---

### 5. `v2_daily_limit_regression.py` — 每日限额回归测试

**作用**：验证 V2 每日花费限额（Daily Limit）功能是否正常。设置限额 = 单次调用价格，第一次调用应成功，第二次应被拦截返回 `402 DAILY_LIMIT_EXCEEDED`。

**测试步骤**（自动执行 7 步）：
1. Owner 钱包签名登录
2. 发现一个服务并获取单价
3. 签发 Agent Credential
4. 设置每日限额 = 单价（只够一次）
5. 链上充值 + 等待确认
6. 第一次调用 → 应成功（200）
7. 第二次调用 → 应被拦截（402）

**环境变量**：

| 变量 | 必填 | 说明 | 默认值 |
|------|------|------|--------|
| `API_BASE` | | Gateway API 地址 | `http://127.0.0.1:8000` |
| `RPC_URL` | | 链 RPC 地址 | `http://127.0.0.1:8545` |
| `OWNER_PRIVATE_KEY` | | Owner 私钥 | Hardhat #0 |
| `DEPLOYER_PRIVATE_KEY` | | 部署者私钥 | Hardhat #0 |
| `OWNER_PAYMENT_PRIVATE_KEY` | | 付款私钥 | 同 `OWNER_PRIVATE_KEY` |
| `PROMPT` | | 调用提示词 | `daily limit regression check` |

**使用方式**：
```bash
python v2_daily_limit_regression.py
```

---

## 本地快速验证全链路

```bash
# 1. 确保 Gateway + Hardhat 本地运行
# 2. 注册服务
export SYNAPSE_GATEWAY_API_BASE=http://127.0.0.1:8000
export SYNAPSE_OWNER_ADDRESS=0x... SYNAPSE_OWNER_BEARER_TOKEN=...
python register_provider_shelf_services.py

# 3. 发现 + 调用（编辑 config.json 后）
python agent_sdk_discover_invoke.py

# 4. 回归测试
python v2_daily_limit_regression.py
```
