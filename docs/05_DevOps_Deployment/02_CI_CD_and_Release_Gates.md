# CI/CD and Release Gates

## 1. 目标

本文件定义 Synapse 的代码门禁、镜像构建、预发布部署和生产发布纪律。

CI/CD 在这里不是“自动跑几个命令”，而是平台资金安全和可发布性的制度化外壳。

## 2. 发布目标

CI/CD 必须保证四件事：

1. PR 合入前，关键路径已经被验证
2. `main` 始终保持可发布
3. 发布产物可追踪、可回滚、不可漂移
4. 生产发布必须通过审批和 smoke check

## 3. 分支与环境模型

### 3.1 分支模型

建议坚持：

1. `main` 是唯一可发布主干
2. `feature/*` 承载日常开发
3. `release/*` 只在需要冻结发布窗口时引入

### 3.2 GitHub Environments

至少维护：

1. `ci`
2. `staging`
3. `production`

其中 `production` 必须启用审批，不允许无审阅直发。

## 4. 必要流水线分层

### 4.1 Pull Request CI

PR 阻断流水线至少要检查：

1. Gateway 单测
2. Gateway 关键金融安全测试
3. admin gateway 测试
4. admin front 构建
5. 合约编译或测试
6. 前端 lint / build
7. 文档链接和关键入口校验

### 4.2 Financial Security CI

这是最高优先级专项流水线。

职责：

1. 拉起临时 PostgreSQL / Redis
2. 导入 schema
3. 运行资金路径回归
4. 校验只读投影与初始化契约
5. 上传测试报告

这条线的定位是：

**任何资金安全回归，都不能进入主干。**

### 4.3 Build Release Images

发布流水线至少要：

1. 构建 `gateway`
2. 构建 `admin/gateway-admin`
3. 构建 `admin/admin-front`
4. 生成镜像 digest
5. 生成 SBOM
6. 执行漏洞扫描

### 4.4 Deploy Staging

预发布部署完成后，至少要做：

1. health check
2. PostgreSQL 连通性校验
3. Redis 连通性校验
4. 最小读链路 smoke check

### 4.5 Deploy Production

生产部署必须遵守：

1. 基于固定镜像 digest
2. 启用环境审批
3. 串行发布，禁止并发冲撞
4. 发布后立即执行 smoke check

## 5. 变更门禁

### 5.1 代码门禁

以下改动必须经过完整门禁：

1. 资金路径逻辑
2. 数据库 schema
3. Gateway invoke / quote / deposit / withdrawal 路径
4. 鉴权与 session 逻辑

### 5.2 文档门禁

凡是 API、字段、状态机、错误码、部署方式变化，必须同步修改文档。

### 5.3 测试门禁

后端行为变化必须伴随测试变化。

没有 Test Diff 的关键后端改动，不应视为完成。

## 6. 版本与制品规则

### 6.1 版本标识

推荐双标识：

1. Git tag，例如 `v0.x.y`
2. 镜像 tag，包括语义版本和 commit SHA

### 6.2 回滚原则

回滚必须回到：

1. 已知镜像 digest
2. 已知数据库迁移位置
3. 已知 smoke check 通过版本

不能依赖浮动 tag 或人工记忆。

## 7. 文档结论

Synapse 的 CI/CD 不是加快发版速度的装饰，而是把：

**代码质量、资金安全、构建制品、环境审批、可回滚性**

固定进工程流程的生产纪律。