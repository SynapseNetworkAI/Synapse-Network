# Postgres Init Gateway Providers Notes

`docker-compose/postgres/init/gateway-providers/` 预留给独立 provider-side PostgreSQL bootstrap 脚本。

当前仓库里的 PostgreSQL 初始化仍以 `gateway` 和 `gateway-admin` 两组数据库对象为主。

后续如果 `provider_service` 演进为独立数据库，再把对应的 `*.sh` 初始化脚本放进这里，由顶层 `000_run_init_tree.sh` 按顺序执行。

## 相关目录

1. `docker-compose/postgres/init/gateway/`
2. `docker-compose/postgres/init/gateway-admin/`
3. `docker-compose/postgres/init/gateway-providers/`
4. `docker-compose/postgres/init/000_run_init_tree.sh`

## 维护原则

1. 顶层目录负责调度，不要把 provider 初始化逻辑散落到其他 bootstrap 目录。
2. provider-side 数据库一旦落地，相关 SQL 与 shell 初始化说明同步更新本文档。
3. 如果只是执行型占位说明，项目目录内保留短入口即可，canonical 内容统一维护在根 `docs/03_Projects/infra/`。