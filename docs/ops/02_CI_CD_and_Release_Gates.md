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
4. admin front lint / test / build
5. 合约编译或测试
6. 前端 lint / test / build
7. 文档链接和关键入口校验

当前仓库脚本入口建议至少固化：

1. `npm run ci:frontend` 作为前端质量门禁入口
2. `npm run ci:pr` 作为 PR 聚合检查入口

当前本地开发默认约束建议：

1. 每个 clone 执行一次 `bash scripts/dev/install_git_hooks.sh`
2. 安装后，`git push` 自动触发 `.githooks/pre-push`
3. `pre-push` 统一执行 `bash scripts/ci/pr_checks.sh`
4. 仅在紧急情况下使用 `git push --no-verify`

当前 `ci:pr` 已接入的仓库门禁建议包括：

1. `apps/frontend`: lint / test / build
2. `services/admin-front`: lint / Vitest / build
3. `gateway`: 创建 `gateway/.venv`，安装目录依赖，再跑 pytest
4. `services/gateway-admin`: 创建 `services/gateway-admin/.venv`，安装目录依赖，再跑完整 pytest suite
5. `provider_service`: 创建 `provider_service/.venv`，安装目录依赖，再跑 pytest
6. `sdk/python`: 创建 `sdk/python/.venv`，安装 editable 依赖，再跑 pytest unit tests + `python -m build`，联调 demo 保持 opt-in
7. root contracts: hardhat compile，若存在 root `test/` 用例则继续执行 hardhat test
8. finance approval fast gates: Semgrep 资金审批规则、local runtime DB 探针门禁、withdrawal E2E 脚本模型漂移扫描
9. Agent architecture gates: Ruff/Radon/JSCPD changed-file gate，防止新增复杂函数和复制粘贴业务逻辑

本地 hook 与 GitHub PR CI 必须共享同一个聚合入口 `scripts/ci/pr_checks.sh`，避免“本地过了、远端挂了”或“本地没拦住、远端才发现”的漂移。

当前 Python 打包校验范围只包括 `sdk/python`，因为它是仓库内唯一带 `pyproject.toml` 的 Python 分发包；`gateway`、`services/gateway-admin`、`provider_service` 当前仍按服务进程治理。

当前 Python CI 的环境原则：

1. 不依赖仓库外部或预先手工激活的 Python 虚拟环境
2. 每个目录在 CI 里自建自己的 `.venv`
3. 每个目录只安装自己的依赖和本次门禁需要的测试工具

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

Provider 提现审批是资金审批 release gate。任何改动触及 Gateway finance/withdraw/refund/balance/ledger、Gateway-admin withdrawal review/finance approval、admin-front withdrawal review 页面、合约 withdrawal 逻辑、或对应 E2E 脚本时，必须满足：

1. `npm run ci:finance-approval-safety`
2. `npm run e2e:admin-withdrawal-approval`
3. `npm run ci:finance-approval-e2e-evidence`

E2E evidence 使用资金敏感目录 hash，而不是只绑定全局 commit SHA。无关 README/docs 小改不会强迫重跑；资金敏感路径变化会让旧证据自动失效。

Gateway full-chain E2E 是 release evidence gate，不属于普通 PR CI。普通 `ci:gateway` 可以在 live services 缺失时让 e2e 测试 skip；release evidence 不允许 skip。发布前必须运行：

1. `npm run release:evidence:gateway-fullchain:staging`
2. `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence`

本地可用 `npm run release:evidence:gateway-fullchain:local` 做 rehearsal，但它只证明本地链路和证据脚本可运行，不替代 staging 或 production Go/No-Go evidence。

### 4.2.1 Agent Architecture Quality Gate

Agent 生成代码必须通过结构门禁，不能靠堆代码、复制粘贴或日志泄露换取功能测试通过。

1. `npm run ci:financial-security` 运行金融安全 Semgrep 规则和 finance-only mypy 数据流门禁。
2. `npm run ci:architecture-quality` 通过 `uvx`-first runner 运行 Ruff、Radon、JSCPD 和 repo-local finance shape scan。
3. `npm run ci:diff-coverage` 运行增量覆盖率门禁，只检查 changed lines，finance-sensitive 路径使用更高阈值。
4. `npm run ci:agent-guardrails` 聚合安全、复杂度、查重、增量覆盖率、runtime guard 和模型漂移扫描。

第一期默认检查 changed files，避免历史复杂代码一次性阻塞全仓；但 finance-sensitive changed files 必须严格通过。
Python guardrail 工具不使用业务 service venv；缺少 `uvx` 且 PATH 上没有对应工具时，门禁 fail closed 并提示安装 `uv`。

增量覆盖率门禁统一读取 Cobertura XML：

1. Python `pytest-cov` 输出 `coverage.xml`。
2. Admin-front Vitest 输出 `services/admin-front/coverage/cobertura-coverage.xml`，且 `ci:admin-front` 本身必须执行 Vitest，不能只依赖手动测试。
3. User-front Vitest 输出 `services/user-front/coverage/cobertura-coverage.xml`。

Diff-based gates require base branch history. GitHub Actions must avoid shallow checkout:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

If CI cannot resolve `origin/main...HEAD`, the gate must fail closed and instruct the workflow owner to fetch base history. It must not silently skip coverage.

### 4.3 Build Release Images

发布流水线至少要：

1. 构建 `gateway`
2. 构建 `services/gateway-admin`
3. 构建 `services/admin-front`
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
