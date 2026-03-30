# Public Environment Status Register

## 0. Metadata

- Status: active
- Owner: Founder / CTO hat
- Date: 2026-03-30
- Related systems: `apps/frontend`, `gateway`, `provider_service`, `contracts`
- Related docs:
  - `docs/exec-plans/active/2026-03-30_Readiness_Gap_List.md`
  - `docs/exec-plans/active/2026-03-30_Week1_Today_Checklist.md`

## 1. Purpose

这份表不是未来规划，而是当前公网 / 演示环境登记表。

它要回答：

1. 哪些东西已经在线
2. 哪些东西只是计划
3. 演示当天依赖哪些地址

## 2. Status Table

| Surface | Current status | Public URL / identifier | Owner | Notes |
| --- | --- | --- | --- | --- |
| `frontend` | `partial` | `TBD` | Founder / CTO | 代码存在，公网地址待登记 |
| `gateway` | `partial` | `TBD` | Founder / CTO | API 运行时存在，公网 base URL 待登记 |
| `provider_service` | `partial` | `TBD` | Founder / CTO | provider runtime 存在，公网入口待登记 |
| `database` | `partial` | `internal` | Founder / CTO | Postgres/MinIO 等内部资源待登记 |
| `contracts` | `partial` | `TBD` | Founder / CTO | 合约地址与 explorer 链接待登记 |
| `domain` | `missing` | `TBD` | Founder / CTO | demo 域名未登记 |
| `testnet` | `partial` | `Arbitrum Sepolia or Base Sepolia` | Founder / CTO | 需在本周锁定唯一主链 |

## 3. Required Fields To Fill This Week

### Frontend

- [ ] 生产 / 演示域名
- [ ] Vercel 或其他部署入口
- [ ] demo 页面 URL

### Gateway

- [ ] 公网 API base URL
- [ ] 健康检查 URL
- [ ] 是否已绑定正确 provider runtime

### Provider Service

- [ ] 公网 provider URL
- [ ] 对应环境变量来源
- [ ] 是否已连上对象存储 / Postgres

### Contracts

- [ ] 当前测试链
- [ ] 合约地址
- [ ] block explorer 链接

### Domain

- [ ] 主域名
- [ ] demo 子域名
- [ ] 需要指向的服务

## 4. Go / No-Go For Demo

演示前必须确认：

1. 前端 URL 打得开
2. gateway API 可达
3. provider_service 可达
4. 合约地址可查
5. 当前测试链唯一明确

## 5. Tomorrow Top 3

1. 锁定唯一测试链
2. 填入当前所有公网 URL
3. 给合约补 explorer 地址

## 6. Validation Log

### 2026-03-30

- Check: 承接 Week 1 清单中 `公网环境现状` 审计需求
- Result: 已创建首版状态登记表
- Follow-up: 目前多数字段仍是 `TBD`，需要真实环境值补齐

