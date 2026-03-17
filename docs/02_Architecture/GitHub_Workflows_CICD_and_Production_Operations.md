# GitHub Workflows 与 CI/CD 及生产运维方案

本文给出 `Synapse-Network` 的 GitHub Workflows、CI/CD、发布、部署、定时任务、日志、监控、告警与容器化的整体设计方案。目标不是写一套“通用 DevOps 教科书”，而是基于当前仓库实际结构给出可落地的方案。

当前仓库的关键事实：

1. 代码是多技术栈混合仓库：
   - `gateway/`：核心资金与支付网关，Python/FastAPI/PostgreSQL/Redis
   - `admin/gateway-admin/`：管理后台后端，Python/FastAPI/PostgreSQL
   - `admin/admin-front/`：管理后台前端，Next.js 14
   - 根目录 `contracts/` 与 Hardhat：智能合约、本地部署脚本、链上 E2E 测试脚本
2. 仓库已经有本地 / 生产脚本与基础设施目录：
   - `scripts/local/`
   - `scripts/prod/`
   - `docker-compose/docker-compose.yml`
   - `infra/docker/postgres/init/`
3. 当前 `.github/workflows/financial-security-ci.yml` 为空，说明 GitHub Actions 体系还没有真正成型。

因此，推荐把 GitHub Workflows 从“一个空 workflow 文件”升级为“分层的工程化流水线体系”。

## 0. GitHub Workflows 可以做什么

GitHub Workflows 本质上是“代码仓库事件驱动的自动化编排层”。对当前 Synapse-Network 这类多服务、多技术栈、带资金链路和后台控制面的仓库，它可以承担下面这些职责：

1. 代码校验
   - PR 创建、更新时自动跑单元测试、构建、合约编译、文档检查。
2. 安全守门
   - 对资金路径、数据库 schema、只读投影、镜像漏洞扫描设置强制门禁。
3. 构建发布产物
   - 自动构建 Docker 镜像、生成版本标签、上传 artifact、记录 digest。
4. 部署编排
   - 通过 environment、审批、并发控制和 secrets 把 staging / production 部署流程标准化。
5. 定时巡检
   - 使用 `schedule` 定时探测健康检查接口、投影视图、关键业务只读接口。
6. 运维联动
   - 在失败时发送 webhook、Slack、飞书、企业微信等告警通知。
7. 变更按需执行
   - 用路径过滤只跑受影响的 job，避免每次改 docs 都把整仓库全量构建一遍。

对当前仓库，已经落地的第一版 workflow 分工如下：

1. `pull-request-ci.yml`
   - 作用：PR 阻断流水线。
   - 当前 job：变更识别、gateway 单测、admin gateway 测试、admin front 构建、合约编译、文档链接检查。
2. `financial-security-ci.yml`
   - 作用：资金安全专项流水线。
   - 当前 job：拉起 Postgres/Redis、执行 PostgreSQL-only 守卫、初始化 schema、验证只读投影、运行关键资金路径测试、上传报告。
3. `build-release-images.yml`
   - 作用：发布镜像构建流水线。
   - 当前 job：预检查 Dockerfile 是否存在，然后按服务构建并推送镜像。
4. `deploy-staging.yml`
   - 作用：预发布部署。
   - 当前 job：校验 staging secrets、SSH 远程部署、执行 smoke check。
5. `deploy-production.yml`
   - 作用：生产部署。
   - 当前 job：校验 production secrets、SSH 远程部署、执行生产 smoke check。
6. `nightly-ops-check.yml`
   - 作用：定时巡检与异常通知。
   - 当前 job：按配置检查夜间健康检查 URL，失败时推送 webhook 告警。

## 1. 设计目标

这套方案要解决五类问题：

1. PR 合并前必须知道代码是否破坏了资金路径、API 合约、数据库契约和前端构建。
2. `main` 分支必须始终保持可发布，而不是“开发大分支”。
3. 发布过程必须产出可追踪、可回滚、不可篡改的构建产物。
4. 上线后不能只靠人工盯日志，必须有定时任务、指标、告警和恢复流程。
5. 生产部署不能继续停留在“脚本 + 手工 + 进程”的状态，至少应用层必须容器化。

## 2. 建议的分支与环境模型

建议采用下面的 GitHub 环境模型。

### 2.1 分支模型

1. `main`
   - 唯一可发布主干。
   - 所有生产镜像、生产部署都从这里或其 tag 产生。
2. `feature/*`
   - 日常开发分支。
   - 只能通过 PR 合入 `main`。
3. `release/*`
   - 可选。
   - 当发布频率上来后，用于冻结版本和补丁修复。

### 2.2 GitHub Environments

至少建立三个 GitHub Environments：

1. `ci`
   - 仅用于测试 job，不保存生产密钥。
2. `staging`
   - 预发布环境。
   - 允许 main 自动部署。
3. `production`
   - 生产环境。
   - 必须启用 required reviewers，禁止自动无审批发布。

### 2.3 版本标识

推荐发布时使用两层标识：

1. Git tag：例如 `v0.9.3`
2. 镜像 tag：
   - `ghcr.io/<org>/synapse-gateway:v0.9.3`
   - `ghcr.io/<org>/synapse-gateway-admin:v0.9.3`
   - `ghcr.io/<org>/synapse-admin-front:v0.9.3`

同时保留 commit SHA tag：

- `:sha-<shortsha>`

这样回滚时不依赖“latest”这种不可追踪标签。

## 3. 推荐的 GitHub Workflows 结构

建议把 `.github/workflows/` 拆成至少 6 个文件，而不是把所有逻辑堆到一个 workflow 中。

### 3.1 `pull-request-ci.yml`

作用：所有 PR 的基础阻断流水线。

触发条件：

- `pull_request` 到 `main`
- 可选 `push` 到 `feature/*`

应该做的事情：

1. 先做变更检测 `paths-filter`，识别变更涉及：
   - `gateway/**`
   - `admin/gateway-admin/**`
   - `admin/admin-front/**`
   - `contracts/**`
   - `infra/**`
   - `docs/**`
2. 针对不同目录做按需 job，避免每次 PR 都把全仓跑满。
3. 把下面这些作为 PR 必须通过的 required status checks。

建议校验项：

1. `gateway` 单元测试
   - `gateway/venv/bin/pytest` 或 Actions 内创建独立虚拟环境
   - 至少跑 `tests/unit/`
2. `gateway` 关键金融安全测试
   - 覆盖充值、退款、对账、索引器、schema contract
   - 这里建议单独 job，不能和普通单元测试混为一谈
3. `admin/gateway-admin` pytest
4. `admin/admin-front` build
   - `npm ci`
   - `npm run build`
5. Hardhat 合约编译 / 测试
   - `npx hardhat compile`
   - 如果已有测试则跑 `npx hardhat test`
6. 基础静态检查
   - Python: `ruff` 或 `flake8`，若团队接受则纳入
   - TypeScript/Next: `npm run lint`
7. 文档完整性检查
   - 至少校验 Markdown 链接与关键文档是否存在

不建议在这个 workflow 中做的事情：

1. 不要在 PR 上直接部署生产。
2. 不要在 PR 上执行真实数据库迁移。
3. 不要依赖开发者本地 venv 或缓存目录。

### 3.2 `financial-security-ci.yml`

作用：把“资金路径是最高优先级”这件事单独制度化。

触发条件：

- `pull_request`
- `push` 到 `main`
- `schedule` 每天至少一次

这个 workflow 应该重点验证：

1. `gateway` 金融安全基线对应测试
2. PostgreSQL schema contract 校验相关测试
3. Redis on/off 双模式关键路径
4. deposit indexer / reconciliation 相关单测
5. 关键 SQL 初始化文件变更时的 bootstrap smoke test
   - `infra/docker/postgres/init/**`
   - `docker-compose/postgres/init/**`

建议增加的特殊动作：

1. 起临时 Postgres + Redis service container
2. 导入 bootstrap SQL
3. 运行 schema smoke test
4. 生成测试报告 artifact

这个 workflow 的定位不是“普通 CI”，而是“阻止任何资金安全回归进入主干”。

### 3.3 `build-release-images.yml`

作用：构建可部署制品并推送镜像仓库。

触发条件：

- `push` 到 `main`
- `push` tag `v*`
- `workflow_dispatch`

应做的事情：

1. 构建 3 类应用镜像：
   - `gateway`
   - `admin/gateway-admin`
   - `admin/admin-front`
2. 给每个镜像打两个 tag：
   - 语义版本 tag 或 `main-<sha>`
   - `sha-<shortsha>`
3. 推送到统一镜像仓库
   - 优先建议 `GHCR`
   - 如果生产在 AWS，则也可以同步推送 ECR
4. 生成 SBOM
5. 对镜像跑漏洞扫描
   - 推荐 `Trivy`
6. 产出构建清单 artifact
   - 记录镜像 digest
   - 记录对应 commit SHA

注意：

1. 生产部署必须基于镜像 digest，不基于浮动 tag。
2. 构建与部署分离，不能一边 build 一边直接上线生产。

### 3.4 `deploy-staging.yml`

作用：把 `main` 最新可发布版本自动推进到 staging。

触发条件：

- `workflow_run` 依赖 `build-release-images.yml` 成功
- 或 `push` 到 `main`

推荐动作：

1. 拉取上一步生成的镜像 digest
2. 执行 staging 数据库迁移
3. 部署 `gateway` / `gateway-admin` / `admin-front`
4. 部署完成后执行 smoke test

staging smoke test 至少要测：

1. `gateway` 健康检查
2. `gateway-admin` 健康检查
3. `admin-front` 页面可访问
4. PostgreSQL 连通性
5. Redis 连通性
6. 一个最小充值 / 查询 / dashboard 读模型链路的只读验证

### 3.5 `deploy-production.yml`

作用：生产发布。

触发条件：

- `workflow_dispatch`
- 或 `release published`
- 或 `push` tag `v*`

生产部署建议流程：

1. 选择待发布 tag 或指定镜像 digest
2. 人工审批进入 `production` environment
3. 先执行 DB migration
4. 再滚动发布应用
5. 发布后自动跑生产 smoke test
6. 发布成功后打 deployment record

生产 workflow 里必须做的保护：

1. required reviewers
2. concurrency control
   - 同一时间只允许一个生产部署
3. timeout
4. rollback instruction artifact

### 3.6 `nightly-ops-check.yml`

作用：定时运营巡检，而不是代码构建。

触发条件：

- `schedule`

应该做的事情：

1. 调用 staging 或 production 的只读巡检接口
2. 检查：
   - indexer 是否在运行
   - reconciliation delta 是否超阈值
   - execution worker backlog 是否堆积
   - dashboard projection 是否新鲜
3. 把巡检结果发送到告警渠道

## 8. 如果不用 GitHub Workflows，有哪些替代方案

可以替代，但要区分“替代 GitHub Actions 引擎”和“替代整套 CI/CD 能力”这两件事。后者几乎不现实，前者则完全可行。

### 8.1 常见替代方案

1. Jenkins
   - 适合需要高度自定义、自建执行器、内网部署、复杂审批流的团队。
   - 优点：灵活、插件生态成熟、可深度接入私有网络。
   - 缺点：维护成本高，插件治理和权限治理复杂。
2. GitLab CI/CD
   - 适合代码仓库本来就在 GitLab，想把源码管理和流水线统一在一处。
   - 优点：CI/CD 一体化能力强，runner 和 environment 能力成熟。
   - 缺点：如果代码主仓仍在 GitHub，会增加双平台管理成本。
3. CircleCI / Buildkite / Drone / TeamCity
   - 适合希望用托管型或更轻量的专用 CI 平台。
   - 优点：部分平台在并发性能、缓存和大规模 runner 管理上更强。
   - 缺点：需要额外平台接入、权限配置和费用治理。
4. 云厂商原生流水线
   - 例如 AWS CodeBuild/CodePipeline、Google Cloud Build、Azure DevOps。
   - 优点：与云资源、镜像仓库、IAM 权限、Kubernetes/VM 部署集成更紧。
   - 缺点：平台锁定更强，跨云和本地环境迁移成本更高。
5. 纯自建脚本 + Cron + SSH
   - 适合最早期、低频发布、小团队阶段。
   - 优点：实现快、依赖少。
   - 缺点：审计弱、可视化弱、失败重试差、审批和权限边界不清晰，不适合资金链路系统长期使用。

### 8.2 对 Synapse-Network 的现实建议

如果不用 GitHub Workflows，最现实的替代顺序是：

1. 首选 Jenkins 或 Buildkite
   - 原因：当前仓库已经在 GitHub，继续保留 GitHub 做源码管理最自然，外接 CI 引擎即可。
2. 如果未来全部基础设施落在单一云厂商上，可考虑云原生流水线
   - 原因：部署、镜像仓库、密钥管理、监控能更紧密打通。
3. 不建议长期停留在“shell 脚本 + 手工 SSH + 定时任务”模式
   - 原因：对支付/账本/后台控制面系统而言，审计性、可回滚性和告警闭环都不够。

### 8.3 替代时要保留的核心能力

无论最终是否继续使用 GitHub Workflows，下面这些能力都必须保留，不能因为换平台而消失：

1. PR 级质量门禁
2. 资金安全专项流水线
3. 构建产物可追踪和可回滚
4. staging / production 环境隔离与审批
5. 定时巡检、日志、告警闭环
6. secrets 和部署权限最小化治理

这个 workflow 不应该替代应用内部 scheduler，但它可以作为“控制平面外部观察者”。

### 3.7 `dependency-security.yml`

作用：依赖与供应链安全。

建议包含：

1. `pip-audit`
2. `npm audit` 或 `pnpm audit`
3. CodeQL
4. Secret scanning
5. 许可证合规检查

## 4. 这些 Workflows 应该验证什么

这里不讲抽象原则，直接给当前项目的校验清单。

### 4.1 Gateway 应该验证的内容

1. 资金路径单元测试
   - deposit intent register/confirm
   - refund create/complete/reject
   - withdrawal approve/reject/complete
2. 对账与索引器测试
   - `process_pending_deposit_intents_once`
   - reconciliation delta calculation
   - backfill cursor persistence
3. PostgreSQL schema contract 测试
   - `gateway/src/storage/postgres/schema_contracts.py`
   - bootstrap SQL 与 repository 假设一致
4. Redis 开启 / 关闭双模式测试
5. API 契约与 Pydantic 校验
6. 关键 smoke test
   - app 启动
   - DB 连通
   - Redis 连通

### 4.2 Admin Gateway 应该验证的内容

1. pytest 全量或核心模块
2. 菜单配置中心 draft/published 流程
3. execution worker job lifecycle
4. dashboard read model 查询
5. 管理员认证与 RBAC

### 4.3 Admin Front 应该验证的内容

1. `npm run build`
2. `npm run lint`
3. 核心页面静态构建成功
4. API 类型兼容性

### 4.4 Contracts 应该验证的内容

1. Hardhat compile
2. 合约测试
3. 部署脚本能否读取并生成 `contract-config.json`
4. 关键 ABI / 地址文件是否同步成功

### 4.5 Infra 应该验证的内容

1. Dockerfile 能 build
2. docker compose 或容器编排模板语法有效
3. PostgreSQL init 脚本可执行
4. migration 脚本幂等或至少可重复 bootstrap 到干净库

## 5. 推荐的 CI/CD 阶段划分

建议把流水线拆成下面 5 个阶段。

### 阶段 1：PR Validate

目标：阻止坏代码进入 `main`。

产出：

1. 测试结果
2. lint 结果
3. build 结果

### 阶段 2：Main Build

目标：把 `main` 构造成可发布制品。

产出：

1. Docker images
2. SBOM
3. 漏洞扫描结果
4. 镜像 digest 清单

### 阶段 3：Staging Deploy

目标：验证“这份制品”可以真实部署与运行。

产出：

1. staging 部署记录
2. smoke test 结果

### 阶段 4：Production Release

目标：有审批地把 staging 已验证制品推进到生产。

产出：

1. release record
2. production deployment record
3. rollback pointer

### 阶段 5：Post-Deploy Ops

目标：持续验证系统还活着、账没坏、任务没堆积。

产出：

1. 定时巡检报告
2. 告警事件
3. 运行指标趋势

## 6. 上线后的发布与部署方案

### 6.1 推荐发布策略

当前阶段最适合的不是复杂多集群编排，而是“镜像化 + staging 验证 + production 审批发布”。

推荐流程：

1. 开发通过 PR 合并到 `main`
2. `main` 自动 build 镜像并推送到 registry
3. 自动部署 staging
4. 人工验证 staging
5. 创建 release tag
6. 生产 workflow 基于 tag 对应镜像 digest 部署 production

### 6.2 部署顺序

生产部署必须有顺序，不能三个服务同时乱滚。

推荐顺序：

1. 数据库 migration
2. `gateway`
3. `admin/gateway-admin`
4. `admin/admin-front`

原因：

1. `gateway` 是资金真相与只读投影源头
2. `gateway-admin` 依赖 gateway 与投影视图
3. `admin-front` 只是消费后端 API，最适合最后切流

### 6.3 回滚策略

推荐使用“镜像回滚 + 数据库前向兼容”的策略。

原则：

1. 应用镜像必须可快速回滚到前一个 digest
2. 数据库 migration 尽量采用 expand-contract 模式
3. 禁止把不可逆 destructive migration 和应用发布绑死在同一秒钟

## 7. 定时任务设计

项目上线后，至少要有两类定时任务：应用内任务和平台外巡检任务。

### 7.1 应用内定时任务

这些任务应继续放在应用内部，因为它们依赖业务上下文。

1. `gateway` deposit indexer
   - 扫描链上充值事件
2. `gateway` reconciliation
   - 比较 `chainVaultUsdc` 与 `ledgerObligationUsdc`
3. `gateway` backfill
   - 恢复漏扫区块
4. `gateway-admin` execution worker
   - 推进审批后的 execution jobs
5. 健康历史清理与运行时状态清理

这些任务要求：

1. 必须具备幂等性
2. 必须输出结构化日志
3. 必须暴露状态指标
4. 必须有 backlog 告警

### 7.2 平台外巡检任务

这些任务适合由 GitHub schedule、云端 scheduler 或监控平台执行。

建议巡检项：

1. 关键健康端点是否可达
2. 最新 projection 更新时间是否超过阈值
3. reconciliation delta 是否超阈值
4. execution jobs 是否堆积
5. PostgreSQL 备份是否成功

推荐执行载体：

1. GitHub Actions schedule：适合轻量外部探测
2. 云厂商 scheduler：适合更稳定的生产巡检
3. Prometheus alert rule：适合高频实时监控

## 8. 日志、监控、告警设计

### 8.1 日志方案

推荐统一使用结构化 JSON 日志。

每条日志至少应包含：

1. `timestamp`
2. `level`
3. `service`
4. `environment`
5. `requestId`
6. `traceId`
7. `ownerAddress`
8. `action`
9. `status`

关键业务日志必须额外覆盖：

1. deposit intent register/confirm
2. refund create/approve/reject/complete
3. withdrawal risk decision
4. reconciliation summary
5. backfill summary
6. execution job attempt result

推荐日志链路：

1. 应用 stdout/stderr
2. 容器日志收集器
3. Loki / Elasticsearch / OpenSearch 之一
4. Grafana / Kibana 查询

### 8.2 指标方案

建议每个服务暴露 Prometheus metrics。

关键指标：

1. HTTP 请求量、错误率、延迟
2. indexer 扫描速率
3. reconciliation delta
4. `deposit_intents` backlog
5. `execution_jobs` backlog
6. PostgreSQL 连接池占用
7. Redis 连接与命令失败率
8. projection staleness
9. 前端可用性探针

### 8.3 告警方案

生产最少应有下面这些告警。

P0 告警：

1. `gateway` 不可用
2. `reconciliation delta > threshold`
3. 数据库不可用
4. migration 失败

P1 告警：

1. indexer 停滞超过 N 分钟
2. execution job backlog 持续增长
3. admin dashboard projection 超时未更新
4. 5xx 错误率升高

P2 告警：

1. Redis 降级
2. 健康探测失败率上升
3. 前端 build 产物部署失败

推荐告警通道：

1. 飞书 / Slack
2. 邮件
3. PagerDuty 或 Opsgenie 用于 P0/P1

## 9. 是否需要 Docker 容器化

结论：需要，而且应该把“应用层必须容器化”作为默认方向。

### 9.1 为什么需要容器化

因为当前项目是多服务、多语言、多依赖版本混合：

1. Python 网关
2. Python 管理后台
3. Next.js 前端
4. PostgreSQL
5. Redis

如果继续依赖裸机脚本：

1. 环境一致性无法保证
2. 回滚速度慢
3. 构建产物不可追踪
4. 监控、日志、扩缩容边界不清晰

### 9.2 哪些应该容器化

建议容器化：

1. `gateway`
2. `admin/gateway-admin`
3. `admin/admin-front`

建议不要自己容器化而是使用托管服务：

1. PostgreSQL
2. Redis

如果暂时没有云托管能力，也可以先在单机或云主机上：

1. 应用层用 Docker
2. PostgreSQL/Redis 先用 Docker Compose

### 9.3 推荐的部署载体选择

按阶段建议如下：

1. 阶段 A：Docker Compose
   - 适合当前验证期、单机预发、小规模生产
2. 阶段 B：ECS / Kubernetes
   - 当需要更稳定滚动发布、自动恢复、水平扩容时升级

如果今天就要选一个最务实方案：

1. 应用镜像统一构建
2. staging 用 Docker Compose 或单机容器编排
3. production 用云主机 + Docker Compose 也能先跑起来
4. 等业务流量起来后再迁移到 Kubernetes 或 ECS

## 10. 推荐的生产拓扑

当前项目推荐的最小生产拓扑：

1. `gateway` 应用实例 2 个以上
2. `admin/gateway-admin` 应用实例 2 个以上
3. `admin/admin-front` 应用实例 2 个以上或静态托管
4. 托管 PostgreSQL 主实例 + 备份
5. 托管 Redis
6. 反向代理 / LB
7. Prometheus + Grafana
8. Loki / OpenSearch 日志系统

如果预算有限，第一阶段可以简化为：

1. 1 台应用机
2. 1 台数据库机或托管数据库
3. 1 个 Redis
4. 最少先把备份、日志聚合、告警补齐

## 11. 推荐的 Secrets 管理

不要把生产密钥放进仓库 env 文件。

建议把下面这些放到 GitHub Environments Secrets 或云端 Secret Manager：

1. `POSTGRES_DSN`
2. `POSTGRES_PASSWORD`
3. `REDIS_URL`
4. `REDIS_PASSWORD`
5. `JWT_SECRET`
6. `AUTH_SECRET`
7. `GATEWAY_INTERNAL_JWT_SECRET`
8. 容器仓库登录凭据
9. 部署机 SSH key 或云 API 凭据

## 12. 推荐的落地顺序

如果分阶段推进，优先顺序建议如下：

### 第一阶段：先把 CI 补完整

1. 建立 `pull-request-ci.yml`
2. 补全 `financial-security-ci.yml`
3. 把 required status checks 配到 GitHub branch protection

### 第二阶段：把镜像化与 staging 发布跑通

1. 为 `gateway` / `gateway-admin` / `admin-front` 编写 Dockerfile
2. 建立 `build-release-images.yml`
3. 建立 `deploy-staging.yml`

### 第三阶段：补生产可观测性

1. Prometheus metrics
2. 结构化日志
3. Grafana dashboard
4. 告警规则

### 第四阶段：启用正式生产发布流程

1. `deploy-production.yml`
2. GitHub Environments 审批
3. 回滚 runbook

## 13. 最终建议

对当前项目，最合理的判断是：

1. 需要 GitHub Workflows，但要按职责拆分，不要继续维持一个空的或大杂烩的 workflow。
2. CI 的重心不只是“代码能跑”，而是“资金路径、数据库契约、前端构建、管理后台都不能退化”。
3. 上线后不能只靠进程脚本，至少应用层必须容器化。
4. PostgreSQL 与 Redis 最终最好使用托管服务，应用层用不可变镜像部署。
5. 定时任务、对账、日志、告警要和发布体系一起设计，不应等上线后再补。

如果后续开始真正实施，建议下一步直接补以下 4 个 workflow 文件：

1. `pull-request-ci.yml`
2. `financial-security-ci.yml`
3. `build-release-images.yml`
4. `deploy-staging.yml`

等这四个落地后，再继续补生产发布与夜间巡检 workflow。