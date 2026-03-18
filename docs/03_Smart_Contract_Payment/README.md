# Smart Contract and Payment Map

本目录承载 Synapse 的资金链路、合约边界、账本、扣费、退款、提现和结算文档。

这是整套文档里最接近“资金真相层”的目录。

## 1. 目录职责

本目录回答以下问题：

1. Owner 如何向 Vault 入金。
2. Agent Runtime 如何从 Owner 余额中消费。
3. Gateway 如何做扣费、记账、审计和回滚。
4. Provider 收益如何累计、锁定、提现。
5. 资金桶、账本、数据模型如何分层。

## 2. 推荐阅读顺序

### 2.1 先看总体模型

1. [Agent_Runtime_Data_Model.md](./Agent_Runtime_Data_Model.md)
   当前目标态数据模型与核心对象。
2. [Vault_Deposit_Architecture.md](./Vault_Deposit_Architecture.md)
   Vault、Owner、Provider、Gateway 的总体资金路径。
3. [Settlement_and_Deduction_Logic.md](./Settlement_and_Deduction_Logic.md)
   调用扣费、结算与收益分拆逻辑。

### 2.2 再看 Owner 资金侧

1. [Owner_Vault_Deposit_End_to_End_Dataflow.md](./Owner_Vault_Deposit_End_to_End_Dataflow.md)
   Owner 入金的真实运行链路。
2. [Owner_Consumer_Refund_Process.md](./Owner_Consumer_Refund_Process.md)
   Owner 消费侧退款、多资金桶与边界说明。

### 2.3 再看 Provider 资金侧

1. [Provider_Withdrawal_Process.md](./Provider_Withdrawal_Process.md)
   Provider 应收提现流程。
2. [Offchain_Billing.md](./Offchain_Billing.md)
   链下扣费与平台内部结算视角补充。

## 3. 与其他目录的关系

1. Runtime 协议与服务发现：回到 `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`。
2. Credential、Budget、Risk：回到 `docs/agent/04_Credential_Budget_Risk_Model.md`。
3. 数据库总览与 schema：回到 `docs/Gateway_Database_Design.md` 和 bootstrap SQL。
4. Gateway 代理转发、日志、安全：回到 `docs/02_Architecture/`。

## 4. 当前 canonical 资金主线

当前推荐按下面顺序理解 Synapse 的资金路径：

1. Owner 向 Vault 入金。
2. 平台把这笔钱登记成 Owner funding intent。
3. Agent Runtime 在 Credential + Budget Policy 边界内消费 Owner 余额。
4. Gateway 做 Discovery、Quote、Invoke、代理转发、扣费、日志和审计。
5. Provider 获得应收。
6. Provider 提现回主钱包。

## 5. 数据库与 SQL 入口

1. [../Gateway_Database_Design.md](../Gateway_Database_Design.md)
2. [../../docker-compose/postgres/init/001_synapse_schema.sql](../../docker-compose/postgres/init/001_synapse_schema.sql)
3. [../../infra/docker/postgres/init/001_synapse_schema.sql](../../infra/docker/postgres/init/001_synapse_schema.sql)

阅读本目录时，始终以最新 SQL 里的 `owner_accounts / provider_profiles / agent_profiles / ledger_accounts / vault_deposits / vault_withdrawals` 这些对象为准，不再沿用旧钱包时代的心智模型。