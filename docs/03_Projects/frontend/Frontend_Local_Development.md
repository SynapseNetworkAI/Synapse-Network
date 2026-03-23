# Frontend Local Development

`apps/frontend/` 是 Synapse 面向 Owner / Developer 的主前端控制台。

## 本地启动

先安装依赖并启动开发环境：

```bash
cd /Users/cliff/workspace/Synapse-Network/apps/frontend
yarn install
yarn dev
```

项目测试命令：

```bash
cd /Users/cliff/workspace/Synapse-Network/apps/frontend
yarn test
```

项目门禁命令：

```bash
cd /Users/cliff/workspace/Synapse-Network
npm run ci:frontend
```

说明：

1. `apps/frontend` 包管理统一使用 Yarn。
2. 不要在这个子项目里执行 `npm install` 或 `npm ci`。
3. 不要重新生成 `package-lock.json`。

## 环境变量

在 `apps/frontend/.env.local` 中至少配置：

```bash
NEXT_PUBLIC_GATEWAY_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS=20000
```

含义：

1. `NEXT_PUBLIC_GATEWAY_BASE_URL`: 前端请求 gateway 的基地址。
2. `NEXT_PUBLIC_SERVICE_LIST_CACHE_TTL_MS`: 服务列表缓存 TTL，推荐 15000-30000ms。

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
5. [../../agent/05_Dashboard_IA_and_Onboarding.md](../../agent/05_Dashboard_IA_and_Onboarding.md)