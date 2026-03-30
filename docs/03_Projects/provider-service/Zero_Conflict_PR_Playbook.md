# Provider Service 零冲突节奏模板（Zero-Conflict PR Playbook）

- Status: supplementary
- Scope: `provider_service` / `docs/provider_service` / `docker-compose/postgres/init/gateway-providers`

## 1) 分支命名模板

每个需求只开一条短分支，禁止在 `work` 长期堆叠。

```text
feature/provider-<service>-<topic>
```

例子：

1. `feature/provider-reddit-download-runtime`
2. `feature/provider-github-release-download`

## 2) Rebase 时机（强制）

开发开始前：

```bash
git fetch origin
git checkout feature/overview-v2
git pull --ff-only origin feature/overview-v2
git checkout -b feature/provider-<service>-<topic>
```

每天第一次提交前（或每 4 小时）执行：

```bash
git fetch origin
git rebase origin/feature/overview-v2
```

开 PR 前最后一次执行：

```bash
git fetch origin
git rebase origin/feature/overview-v2
```

## 3) PR 拆分粒度（避免大而全）

一个 PR 只允许一个服务主题，建议最多覆盖：

1. `endpoint + schema + service + repository`
2. 对应 `00x SQL + apply.sh`
3. 对应测试
4. 必要文档同步

禁止把多个站点（例如 Reddit + GitHub Releases + Paper）打进同一 PR。

## 4) 合并顺序（高冲突文件后置）

按以下顺序开发并提交，冲突显著下降：

1. 代码主链：`provider_service/app/**`
2. 测试：`provider_service/tests/**`
3. SQL 脚本：`docker-compose/postgres/init/gateway-providers/00x_*`
4. 最后再改热点清单文档：
   - `docker-compose/postgres/init/gateway-providers/README.md`
   - `docs/03_Projects/infra/Postgres_Init_Gateway_Providers_Notes.md`
   - `docs/03_Projects/provider-service/README.md`
   - `docs/provider_service/api/README.md`

## 5) 提交前冲突预检

```bash
git status --short
git diff --check
git fetch origin
git rebase --rebase-merges origin/feature/overview-v2
```

如果 rebase 出冲突，只修当前 PR 相关文件，禁止顺手改无关目录。

## 6) 锁文件治理

`apps/frontend/yarn.lock`、`admin/admin-front/yarn.lock` 如果不是本需求范围，必须保持不入 PR：

```bash
git restore --staged apps/frontend/yarn.lock admin/admin-front/yarn.lock || true
git checkout -- apps/frontend/yarn.lock admin/admin-front/yarn.lock || true
```

## 7) 发布节奏建议

1. 每个服务能力：`设计 -> 实现 -> 测试 -> 文档` 单独闭环
2. 每天最多合并 1~2 个 provider 功能 PR
3. 大型 refactor（如下载统一框架）独立 PR，不与新站点接入混合
