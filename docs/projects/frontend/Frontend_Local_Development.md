# Frontend Local Development

`services/user-front/` 是 Synapse 面向 Owner / Developer 的主前端控制台。

## 本地启动

先安装依赖并启动开发环境：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/user-front
yarn install
yarn dev
```

项目构建命令：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/user-front
yarn build
```

项目测试命令：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/user-front
yarn test
```

项目门禁命令：

```bash
cd /Users/cliff/workspace/agent/Synapse-Network
npm run ci:frontend
```

说明：

1. `services/user-front` 包管理统一使用 Yarn。
2. 不要在这个子项目里执行 `npm install` 或 `npm ci`。
3. 不要重新生成 `package-lock.json`。
4. `yarn build` 会先清理 `.next/`，避免旧的路由构建产物把 App Router 页面打成 `PageNotFoundError`。

## 环境变量

`yarn dev` 和 `yarn build` 会先运行 `node scripts/validate_env.mjs`。缺少必需配置时必须失败，不允许带着隐性 fallback 启动到本地、staging 或 prod。

在 `services/user-front/.env.local` 中至少配置：

```bash
NEXT_PUBLIC_GATEWAY_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_ANALYTICS_ENDPOINT=http://127.0.0.1:8000/api/v1/events
NEXT_PUBLIC_APP_ENV=local
NEXT_PUBLIC_DOCS_BASE_URL=http://localhost:3100
NEXT_PUBLIC_TX_EXPLORER_BASE_URL=http://localhost:5100
NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS=20000
NEXT_PUBLIC_SUPPORT_EMAIL=support@synapse-network.ai
NEXT_PUBLIC_SUPPORT_PORTAL_URL=
```

也可以先从示例文件起步：

```bash
cp services/user-front/.env.local.example services/user-front/.env.local
```

如果当前就是准备切到 `Arbitrum Sepolia`，再补一步：

```bash
cp services/user-front/src/contract-config.arbitrum-sepolia.example.json services/user-front/src/contract-config.json
```

含义：

1. `NEXT_PUBLIC_GATEWAY_BASE_URL`: 前端请求 gateway 的基地址。
2. `NEXT_PUBLIC_ANALYTICS_ENDPOINT`: 浏览器事件上报地址，必须指向同环境 Gateway `/api/v1/events`。
3. `NEXT_PUBLIC_APP_ENV`: 当前公开环境标识，允许 `local`、`staging`、`prod`。
4. `NEXT_PUBLIC_DOCS_BASE_URL`: 本地必须指向独立 docs-front `http://localhost:3100`。
5. `NEXT_PUBLIC_TX_EXPLORER_BASE_URL`: invoice / tx 跳转地址；local 默认使用 Docker Compose 里的 Otterscan `http://localhost:5100`，staging 使用 `https://sepolia.arbiscan.io`，prod 使用 `https://arbiscan.io`。
6. `NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS`: 服务列表缓存 TTL，推荐 15000-30000ms。
7. `NEXT_PUBLIC_SUPPORT_EMAIL` / `NEXT_PUBLIC_SUPPORT_PORTAL_URL`: Credits、Dashboard、Feedback fallback 的用户支持入口，至少配置一个。缺失时启动/构建必须失败。
8. `NEXT_PUBLIC_REOWN_PROJECT_ID` / `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: 钱包连接项目 ID，可选。
9. `contract-config.json`: 填入目标测试网的 `MockUSDC / Treasury / SynapseCore` 地址。

## 钱包支持说明

当前 `services/user-front` 运行时默认围绕 `Arbitrum Sepolia`（staging）和 `Arbitrum One`（prod）。

- `MetaMask` / `Rabby`: 当前 Arbitrum 环境的推荐钱包。
- `Phantom`: 支持部分 EVM 链，但 **不支持 Arbitrum**，也不能在 Phantom 里手动添加自定义网络。
- 如果用户在 Synapse 的 Arbitrum 环境里使用 Phantom，前端应明确提示改用 `MetaMask` 或 `Rabby`，而不是一直卡在连接中。

支持矩阵的当前产品口径：

- `Arbitrum One / Arbitrum Sepolia` → `MetaMask` / `Rabby`
- `Ethereum / Base / Polygon` → `Phantom` 可能可用，但不构成 Synapse 当前 Arbitrum 环境的正式支持承诺

共享测试网 / 预发环境建议直接使用：

```bash
cp services/user-front/.env.staging.example services/user-front/.env.staging
```

## 启动健康检查约束

根命令 `npm run dev:all` / `scripts/local/start_all_services.sh` 启动 user-front 后，会在 120 秒内检查：

```text
http://127.0.0.1:3000/dashboard/account/settings
```

如果健康检查失败，启动脚本必须失败并打印最近的 `services/user-front/frontend_dev.log`。这条约束用于阻止“端口短暂打开但 Next 实际不可用”的假启动，staging/prod 发布脚本也必须保持同样思路：部署后先跑 HTTP smoke，再标记发布成功。

## 本地访问

启动后访问：

```text
http://localhost:3000
```

## 开发说明

1. 页面代码主入口在 `apps/frontend/src/`。
2. 产品与交互基线优先遵循根 `docs/Design.md` 与 `docs/01_Product_Frontend/`。
3. 子项目规则见 [Frontend_Agent_Rules.md](./Frontend_Agent_Rules.md)。

## 相关文档

1. [README.md](./README.md)
2. [Frontend_Agent_Rules.md](./Frontend_Agent_Rules.md)
3. [../../01_Product_Frontend/README.md](../../01_Product_Frontend/README.md)
4. [../../Design.md](../../Design.md)
5. [../../06_Reference/04_Development_Testing_and_Integration_Reference.md](../../06_Reference/04_Development_Testing_and_Integration_Reference.md)
