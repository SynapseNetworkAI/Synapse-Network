# frontend

`apps/frontend/` 是 Synapse 面向 Owner / Developer 的主前端控制台。

## 文档入口

1. 项目导航页：`docs/03_Projects/frontend/README.md`
2. 本地开发说明：`docs/03_Projects/frontend/Frontend_Local_Development.md`
3. 子项目规则：`apps/frontend/AGENTS.md`

## 常用命令

```bash
cd /home/alex/Documents/cliff/Synapse-Network/apps/frontend
yarn install
yarn dev
yarn build
yarn test
```

## 说明

1. 包管理统一使用 Yarn。
2. 不要在这个子项目里执行 `npm install` 或 `npm ci`。
3. 完整环境变量、门禁命令与设计入口统一维护在根 `docs/03_Projects/frontend/`。
4. `yarn build` 会先清理 `.next/`，避免历史路由产物导致的 Next 构建脏状态。
