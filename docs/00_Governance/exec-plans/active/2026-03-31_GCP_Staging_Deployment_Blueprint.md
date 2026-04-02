# GCP Staging Deployment Blueprint

## 0. Metadata

- Status: active
- Owner: Founder / CTO hat
- Date: 2026-03-31
- Related systems: `apps/frontend`, `gateway`, `provider_service`, `docker-compose/`, `contracts`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Public_Deployment_Checklist.md`
  - `docs/exec-plans/active/2026-03-30_Public_Environment_Status_Register.md`
  - `docs/exec-plans/active/2026-03-30_Testnet_Selection_and_Config_Checklist.md`
  - `docs/03_Projects/gateway/Gateway_Local_Development.md`
  - `docs/03_Projects/provider-service/Provider_Service_Local_Development.md`

## 1. Executive Decision

当前最适合 Synapse 的对外演示环境，不是：

1. 单台 VM 全塞进去
2. Jenkins + Nginx + Docker Compose 自己养
3. 直接上 GKE / Kubernetes

当前最适合的是：

1. `frontend` 单独一个 Cloud Run service
2. `gateway` 单独一个 Cloud Run service
3. `provider_service` 单独一个 Cloud Run service
4. `PostgreSQL` 用 `Cloud SQL for PostgreSQL`
5. `镜像仓库` 用 `Artifact Registry`
6. `密钥` 用 `Secret Manager`
7. `对外 HTTPS` 用 `Global External Application Load Balancer + Serverless NEG + Certificate Manager`
8. `对象存储` 当前阶段先保留 `MinIO`，跑在一台小型 `Compute Engine VM` 上

一句话：

**对外只做一个 `staging`，让它既是共享测试网环境，也是投资人 demo 环境。**

## 2. Why This Is The Right Call

### 2.1 为什么不用 Jenkins

现在不建议搭 Jenkins。

原因：

1. 你现在只有 3 个核心运行服务，Jenkins 太重
2. Jenkins 需要你自己管插件、升级、凭证和备份
3. GCP 原生已经有 `Cloud Build triggers`，Cloud Run 也能接 GitHub 持续部署

当前建议：

1. `GitHub -> Cloud Build trigger -> Artifact Registry -> Cloud Run`

如果你后面强依赖多仓库、多审批、多阶段流水线，再考虑 Jenkins 或 GitHub Actions 深化。

### 2.2 为什么不用 GKE / Kubernetes

现在不建议上 GKE。

原因：

1. 你现在是 `frontend + gateway + provider_service` 三服务，不是几十个微服务
2. 还没有 Service Mesh、HPA 策略、命名空间治理、多环境编排的真实需求
3. GKE 会显著增加 ops 负担，不适合当前“先把公网 demo 打穿”的阶段

### 2.3 为什么不用单台 VM + docker compose

如果你只想“今晚先上线一个能看”，单台 VM 的确能跑。
但如果目标是“给投资人演示，外网可访问，可重启，可扩展，可回滚”，还是不如 Cloud Run 组合稳。

单 VM 最大的问题：

1. 单点更重
2. 证书、Nginx、systemd、镜像更新都得自己扛
3. 某个服务炸了容易拖全场

## 3. What Is Still Missing Before Staging

当前离公网 `staging` 还差的不是 Dockerfile，而是下面这些真实值和托管资源：

1. `frontend / gateway / provider_service` 的真实公网 URL 还是 `TBD`
2. `Arbitrum Sepolia` 合约地址还没回填到正式公网配置
3. `gateway/.env.staging`、`provider_service/.env.staging`、`apps/frontend/.env.staging` 还没有填成真实值
4. `provider_service` 当前对象存储只支持 `MinIO`，还没支持 `Google Cloud Storage`
5. `provider_service` 的外部 API 密钥还没系统化放进 Secret Manager
6. 域名、子域名、证书、DNS 还没接到真实服务
7. 还没有一条真实的 CI/CD 发布流水线

## 4. Recommended GCP Service List

## 4.1 必开服务

1. `Cloud Run`
2. `Artifact Registry`
3. `Cloud Build`
4. `Secret Manager`
5. `Cloud SQL for PostgreSQL`
6. `Cloud Load Balancing`
7. `Certificate Manager`
8. `Cloud DNS` 或继续用你当前域名商 DNS
9. `Compute Engine`
10. `Cloud Logging`
11. `Cloud Monitoring`

## 4.2 条件开启

1. `VPC` / `Direct VPC egress`
   用于 Cloud Run 连私网 Cloud SQL 和私网 MinIO VM
2. `Serverless VPC Access`
   只有当 `Direct VPC egress` 因限制无法用时再启
3. `Memorystore for Redis`
   当前不是 staging 必需，只有 `gateway` 真开始需要分布式限流或缓存时再开

## 4.3 当前不建议买

1. `GKE`
2. `Jenkins VM`
3. 额外自建 `Nginx ingress` 集群

## 5. Recommended Topology

```text
Internet
  -> Global HTTPS Load Balancer
    -> frontend-staging (Cloud Run)
    -> api-staging (Cloud Run: gateway)
    -> provider-staging (Cloud Run: provider_service)

Cloud Run services
  -> Artifact Registry (deploy images)
  -> Secret Manager (runtime secrets)
  -> Cloud SQL PostgreSQL (gateway + provider_service)
  -> Compute Engine VM (MinIO, private only)
  -> Arbitrum Sepolia RPC
```

## 6. Domain And Subdomain Plan

建议直接开子域名，不要所有东西都挤一个根域。

推荐：

1. `staging.yourdomain.com`
   给 `frontend`
2. `api-staging.yourdomain.com`
   给 `gateway`
3. `provider-staging.yourdomain.com`
   给 `provider_service`

可选：

1. `admin-staging.yourdomain.com`
   以后如果你要把 `gateway-admin` 也开出来
2. `minio-staging.yourdomain.com`
   不建议公网直接开；如果一定要开，只给内网或 IP 白名单

结论：

1. 要开子域名
2. 最少 3 个
3. `MinIO` 不建议暴露公网

## 7. Service Split

多个服务必须分开部署。

原因：

1. `frontend` 是 Node / Next
2. `gateway` 是资金和签发主链路
3. `provider_service` 是样板 provider runtime

它们生命周期、伸缩策略、密钥、健康检查都不同。

当前建议：

1. `frontend` 一个 Cloud Run service
2. `gateway` 一个 Cloud Run service
3. `provider_service` 一个 Cloud Run service
4. `minio` 一个 Compute Engine VM 上的 Docker 容器
5. `postgres` 一个 Cloud SQL 实例

## 8. Nginx Needed Or Not

当前推荐方案里：

1. 不需要 Nginx 给 `frontend / gateway / provider_service` 做公网入口
2. 由 `Google Cloud HTTPS Load Balancer` 负责 TLS、域名、路由和健康检查

只有在下面场景才考虑 Nginx：

1. 你最终改成单台 Compute Engine VM 自己跑 Docker
2. 你要给 MinIO Console 做额外的 Basic Auth / IP 白名单反代

结论：

**Cloud Run 路线下，公网入口不需要 Nginx。**

## 9. Staging Build And Release Strategy

建议路线：

1. `main` 不直接自动发 staging
2. 建 `staging` 发布触发
3. 每次合并到 `main` 后，手动触发或 tag 触发 staging 发布

推荐流水线：

1. `Cloud Build trigger`
2. 构建镜像
3. 推到 `Artifact Registry`
4. 部署三个 Cloud Run services
5. 冒烟检查 `health / discover / provider health`

当前阶段不建议 Jenkins。

## 10. Networking And Security

## 10.1 Cloud SQL

推荐：

1. `Cloud SQL for PostgreSQL`
2. 与 Cloud Run 同区域
3. 优先用私网连接

## 10.2 MinIO

由于代码当前只支持 `MinIO`，最快 staging 路线是：

1. 起一台 `e2-small` 或 `e2-medium` Compute Engine VM
2. 只跑一个 `MinIO` Docker 容器
3. 不开公网 9000 / 9001
4. 只允许来自 Cloud Run 所在 VPC 的内网访问

中期更优方案：

1. 给 `provider_service` 增加 `Google Cloud Storage` adapter
2. 干掉 staging MinIO VM

## 10.3 Secrets

下面这些都进 `Secret Manager`：

1. `gateway` 的 `PRIVATE_KEY`
2. `JWT_SECRET`
3. `AUTH_SECRET`
4. `GATEWAY_PROVIDER_SIGNATURE_SECRET`
5. `PROVIDER_SERVICE_POSTGRES_DSN`
6. `POSTGRES_DSN`
7. `ETHERSCAN_API_KEY`
8. `TWITTER_X_API_*`
9. `VIDEO_STORAGE_MINIO_*`

## 11. Concrete Staging Rollout Steps

## 11.1 Day 0: 准备资源

1. 新建 `staging` GCP project 或在现有 project 下独立命名资源
2. 开通：
   - Cloud Run
   - Artifact Registry
   - Cloud Build
   - Secret Manager
   - Cloud SQL Admin
   - Compute Engine
   - Load Balancing
   - Certificate Manager
   - Cloud DNS（如果你要把 DNS 也迁进 GCP）
3. 申请一个全球静态 IP 给 HTTPS Load Balancer

## 11.2 Day 1: 数据层

1. 建 `Cloud SQL PostgreSQL` 实例
2. 建两个数据库：
   - `synapse_gateway`
   - `synapse_gateway_providers`
3. 运行仓库里的 bootstrap SQL
4. 建 staging 专用数据库用户

## 11.3 Day 1: 对象存储层

1. 建一台小型 `Compute Engine` VM
2. 用 Docker 起 `MinIO`
3. 建 bucket
4. 只给 VPC 内访问

## 11.4 Day 2: 镜像与运行服务

1. 建 `Artifact Registry` Docker repo
2. 分别构建：
   - `frontend`
   - `gateway`
   - `provider_service`
3. 分别部署到 3 个 Cloud Run services

## 11.5 Day 2: 域名与 HTTPS

1. 建 `Global External Application Load Balancer`
2. 后端挂 3 个 `serverless NEG`
3. 用 `Certificate Manager` 发 Google-managed cert
4. 配 DNS：
   - `staging.yourdomain.com`
   - `api-staging.yourdomain.com`
   - `provider-staging.yourdomain.com`

## 11.6 Day 3: 冒烟与路演链

1. `frontend` 打开正常
2. `gateway /health` 正常
3. `provider_service /health` 正常
4. `discover -> quote -> invoke` 至少 1 条公网成功
5. Hero Demo 两条链至少 1 条公网复现

## 12. Recommended Staging Env Mapping

### 12.1 Frontend

1. `NEXT_PUBLIC_GATEWAY_BASE_URL=https://api-staging.yourdomain.com`
2. 合约地址切 `Arbitrum Sepolia`

### 12.2 Gateway

1. `POSTGRES_DSN` 指向 Cloud SQL
2. `RPC_URL` 指向 `Arbitrum Sepolia`
3. `ROUTER_ADDRESS` / `USDC_TOKEN_ADDRESS` 填测试网真实值
4. `PRIVATE_KEY` 用 staging withdraw signer

### 12.3 Provider Service

1. `PROVIDER_SERVICE_POSTGRES_DSN` 指向 Cloud SQL provider DB
2. `GATEWAY_PROVIDER_SIGNATURE_SECRET` 与 gateway 对齐
3. `VIDEO_STORAGE_MINIO_*` 指向私网 MinIO
4. 外部 API keys 从 Secret Manager 注入

## 13. Missing Product Gaps That Still Matter

就算基础设施上去，下面这些还会继续影响对外演示质量：

1. 真实公网合约地址还没回填
2. 对外 demo 域名还没落库登记
3. `provider_service` 的对象存储还没原生支持 GCS
4. YouTube 下载链不适合正式公网卖，需要维持 `internal-only` 认知
5. `gateway-admin` 还不在当前 staging 主链里

## 14. Final Recommendation

当前最优解：

1. 只做一个对外 `staging`
2. `frontend / gateway / provider_service` 分开部署到 Cloud Run
3. `Cloud SQL` 承担数据库
4. `MinIO` 暂时跑在 Compute Engine VM
5. 用 `Artifact Registry + Cloud Build`
6. 不搭 Jenkins
7. 不上 GKE
8. 用 HTTPS Load Balancer，不用 Nginx
9. 至少开 3 个子域名

## 15. Validation Log

### 2026-03-31

- Check: 结合现有仓库 Dockerfile / env 模板 / public deployment checklist，补一版 Google Cloud staging 蓝图
- Result: 已收口到 `Cloud Run + Cloud SQL + Artifact Registry + Secret Manager + HTTPS Load Balancer + MinIO VM`
- Follow-up: 下一步把真实 GCP project、域名、Cloud SQL instance、Cloud Run services 和合约地址回填进 `Public_Environment_Status_Register`
