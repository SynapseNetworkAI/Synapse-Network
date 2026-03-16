# V2 Deposit Indexer 设计与补账运维手册

本文说明 `gateway/src/services/platform/tasks/deposit_indexer/` 下各个任务模块的职责，以及为什么当前设计可以尽量保证“用户充值”与“平台账本余额”一致。同时回答几个运维问题：

- `lastScannedBlock` 是什么
- 直接修改 `lastScannedBlock` 能不能补历史漏账
- 如何补历史上“用户已充值，但平台未到账”的记录
- 扫描历史链上充值记录是否消耗 gas
- 更好的历史补账方案是什么

## 1. 模块职责

当前 V2 充值索引被拆分在 `gateway/src/services/platform/tasks/deposit_indexer/` 中，职责如下。

### 1.1 `shared.py`

负责共享运行时对象：

- `w3`：链上 RPC 客户端
- `INDEXER_STATUS`：对外暴露的内存状态快照
- `lock`：保证单进程内的 indexer 写入串行化
- `logger`：统一运维日志输出

这部分不是资金真相来源，只是运行时控制面。

### 1.2 `persistence.py`

负责统一访问存储层：

- 读取和写入 `deposit_intents`
- 读取和写入 `processed_deposit_event_keys`
- 读取和写入 `deposit_backfill_state`
- 读取和写入 `deposit_reconciliation_state`
- 追加审计日志

这里的关键点是：`deposit_backfill_state` 和 `deposit_reconciliation_state` 都落到 PostgreSQL 的 `synapse_runtime_state`，因此服务重启后可以恢复，不依赖内存。

### 1.3 `chain.py`

负责链上读取和事件解析：

- 读取交易回执 `receipt`
- 计算确认数 `confirmations`
- 优先按 `SynapseCoreABI` 解码标准充值事件
- 如果标准事件不可用，则退化到 ERC20 `Transfer` 到 router 的日志解析
- 把原始金额换算成 USDC 金额

这部分只做链上事实识别，不做账本写入。

### 1.4 `processing.py`

负责把链上事实推进成平台资金结果：

- 校验 intent 基础字段
- 判断交易是否确认、是否成功
- 匹配属于该用户的 deposit event
- 用 `eventKey` 防止重复记账
- 调用 `confirm_deposit_intent_atomic()` 做原子确认
- 对历史脏数据做 repair：`CONFIRMED` 但钱还卡在 `pending_balance`

这是“用户充值和平台余额保持一致”的核心模块。

### 1.5 `backfill.py`

负责补扫历史区块：

- 根据 `deposit_backfill_state.lastScannedBlock` 决定从哪里开始扫
- 在区块范围内收集打到 router 的候选交易
- 读取 receipt 并解出 deposit 事件
- 如果链上有充值事件但本地没有 intent，则创建 recovery intent
- 然后复用 `processing.py` 的确认逻辑，把这笔钱补到账本里

它解决的是“漏掉的历史充值怎么补”。

### 1.6 `reconciliation.py`

负责对账：

- 读取链上 router/vault 的真实 USDC 余额
- 读取平台账本中的 `buyer available + buyer pending`
- 比较二者差值 `deltaUsdc`
- 超过阈值则告警并记录 runtime state / audit

它不是直接补账逻辑，而是发现不一致的报警器。

### 1.7 `runner.py`

负责常驻任务调度：

- 启动时从数据库恢复 runtime 状态
- 周期执行 backfill
- 周期执行 `process_pending_deposit_intents_once`
- 按间隔执行 reconciliation
- 提供管理员 `replay_deposit_tx(txHash)` 能力

它是总控循环，不直接决定资金规则。

## 2. 为什么这套设计能保证充值与平台余额一致

严格来说，这套设计追求的是“最终一致性 + 原子确认”，不是“看到链上事件的一瞬间立刻一致”。

### 2.1 资金状态分两段推进

一笔充值不是直接加到 `available_balance`，而是分两步：

1. 注册充值意图时：先写入 `deposit_intent`，并把金额放进 `pending_balance`
2. 交易达到确认数后：再原子地把金额从 `pending_balance -> available_balance`

这样做的好处是：

- 链上未确认时，不会提前给用户可用余额
- 确认后，账本迁移是单事务完成，不容易出现“链上到了，但余额丢了半步”的状态

### 2.2 原子确认是关键，不靠内存账本快照拍脑袋

`processing.py` 会优先调用 `confirm_deposit_intent_atomic()`。这意味着：

- intent 状态更新
- `pending_balance -> available_balance`
- eventKey 防重

应该在 PostgreSQL 内部一次性完成，而不是先改内存、再整表覆盖。

这避免了最危险的问题：某个线程已经把钱确认好了，另一个旧快照又把余额写回去，导致金额回退。

### 2.3 `eventKey` 防重，避免重复入账

每个链上事件会形成唯一 `eventKey = txHash:logIndex`。

只要该 key 已经进入 `processed_deposit_event_keys`，系统就不应该再给这笔钱重复加余额。这是“补账”和“防双花”之间最重要的保护线。

### 2.4 backfill 解决漏扫，reconciliation 解决漏发现

- backfill：补扫历史区块，把漏掉的充值重新找回来
- reconciliation：比对链上金库余额和平台账本义务，发现系统已经偏了

二者一起工作时，系统不是只会“等用户报错”，而是会主动发现并尝试修复。

### 2.5 repair 路径解决历史脏状态

当前代码已经支持一种常见历史脏数据修复：

- intent 已经是 `CONFIRMED`
- 但资金还留在 `pending_balance`

这时 indexer 再次处理时，会走 repair 路径，把钱补到 `available_balance`，而不是因为 intent 已确认就永远跳过。

## 3. `lastScannedBlock` 到底是什么

`deposit_backfill_state` 类似下面这样：

```json
{
  "updatedAt": "2026-03-16 02:40:55",
  "lastScanAt": 1773628854,
  "lastScannedBlock": 1
}
```

语义是：

- `lastScannedBlock`：数据库里记录的“历史补扫已经处理到哪个块”
- `lastScanAt`：上一次补扫执行时间
- `updatedAt`：runtime state 最后更新时间

注意：

- 它只是 **补扫游标**
- 它不是“平台真实余额”
- 它也不是“某个用户已经到账的证明”

重启后，backfill 会优先从 `lastScannedBlock + 1` 开始继续扫。

## 4. 我把 `lastScannedBlock` 改小，会自动补历史漏账吗

答案是：**有可能，但不是绝对保证；要看漏账属于哪一种。**

### 4.1 能补上的情况

如果满足下面条件，改小 `lastScannedBlock` 后重新 backfill，通常可以补上：

1. 用户当时确实把钱打进了 router / vault
2. 那笔交易在链上还能查到 receipt 和事件
3. 系统之前没有把对应 `eventKey` 标记成“已处理”
4. 或者虽然 intent 已存在，但仍能走 repair/confirm 路径

这种情况下，backfill 重新扫到那笔交易，会：

- 创建 recovery intent，或者找到原 intent
- 再走一次 `_process_single_intent()`
- 把漏掉的金额补进平台账本

### 4.2 不能只靠改游标补上的情况

下面几种情况，单纯把 `lastScannedBlock` 改小，不一定能补：

1. `processed_deposit_event_keys` 已经记录了该 `eventKey`
原因：backfill 会认为这笔事件已经消费过，直接跳过，防止重复记账。

2. 历史数据已经被错误标成失败或重复，且没有进入 repair 路径
原因：当前逻辑主要自动修 `CONFIRMED 但 pending 未释放`，不是所有坏状态都能无脑修。

3. 链上事件本身解析不到
原因：如果历史交易不是当前 ABI/Transfer 退化逻辑能识别的形式，backfill 也找不到。

4. 你改得太小，范围太大，扫描周期太长
原因：理论上能补，但需要大量 RPC 时间，不是马上就看到结果。

### 4.3 结论

所以，**把 `lastScannedBlock` 改小，不是“强制补账开关”，而是“允许 backfill 重新扫描那段历史”的开关。**

它能不能补全，取决于：

- 链上事实是否还在
- 本地去重状态是否允许重放
- 该笔记录落在什么坏状态上

## 5. 如果要补全历史“用户已充值但平台未到账”，正确做法是什么

建议按下面优先级处理。

### 5.1 已知具体 `txHash` 时，优先用 `replay_deposit_tx`

如果你已经知道那笔交易哈希，最稳的办法不是先改 `lastScannedBlock`，而是直接做定点 replay。

优点：

- 范围小
- 风险低
- 结果可审计
- 不需要重扫很大区块区间

适合：客服工单、用户明确反馈某一笔充值没到账。

### 5.2 未知具体交易，但知道时间区间时，用 backfill 回扫区块范围

如果只知道“大概某几天有问题”，可以：

1. 把 `lastScannedBlock` 暂时回拨到问题区间之前
2. 启动 backfill 重新扫那段区块
3. 观察日志中的：
   - `deposit backfill start`
   - `candidate_txs`
   - `recovered`
   - `deposit credited`

这适合一小段历史回补，不适合无限制全链回扫。

### 5.3 大规模历史补账时，不建议继续用当前“整块遍历交易”方式硬扫

当前 backfill 的做法是：

- 按区块取 `full_transactions=True`
- 找目标地址是 router 的交易
- 再读每笔 receipt

这个方案对最近区块或短时间回补没问题，但对非常长的历史区间效率一般。

更好的方案是做一个 **一次性历史补账脚本**：

1. 优先用 `eth_getLogs` 按 topic 过滤 router 的充值事件
2. 分片扫描，例如每次 `2,000` 或 `5,000` 个块
3. 把链上事件先落临时表
4. 再与本地 `deposit_intents / processed_event_keys / balances` 做比对
5. 生成三类结果：
   - 缺失 intent
   - intent 存在但未确认
   - 已确认但余额未迁移
6. 最后只对异常项做 replay / repair

这样比直接把常驻 indexer 当“全历史数据修复器”更安全，也更便于审计。

### 5.4 推荐的生产级补账流程

推荐流程：

1. 先运行 reconciliation，确认差额规模
2. 再导出异常用户或异常 txHash 清单
3. 已知 txHash 的，直接 replay
4. 未知 txHash 的，按时间窗做分段 backfill
5. 如果差额很大，改用一次性 `eth_getLogs` 历史补账脚本
6. 全程记录 audit log 和 repair 报告

## 6. 扫描“用户打入智能合约的全部记录”会消耗 gas 吗

**不会消耗链上 gas。**

原因是当前做的都是只读操作：

- `eth_getBlockByNumber`
- `eth_getTransactionReceipt`
- `eth_call`
- `eth_getLogs`

这些都是 RPC 读取，不会发交易，不会修改链上状态，因此不会产生 gas。

但是会消耗下面这些成本：

- RPC 节点吞吐
- 第三方 RPC 服务费用或配额
- 本地 CPU / 内存 / 网络时间
- 运维等待时间

所以它是“**不花 gas，但会花时间和 RPC 成本**”。

## 7. 更好的方案是什么

如果目标是长期可维护，而不是临时修一次，推荐这样升级。

### 7.1 常驻 indexer 继续负责近期最终一致性

保留现在的三件套：

- pending intent 周期确认
- backfill 小窗口补扫
- reconciliation 差额告警

这部分负责日常运行。

### 7.2 单独提供“历史补账任务”而不是滥用 `lastScannedBlock`

建议新增独立任务，例如：

- `historical_repair_job`
- 输入：起止区块、可选 owner、可选 txHash 列表
- 输出：repair report

这样避免直接人工改 runtime state，降低误操作风险。

### 7.3 历史扫描改成 `eth_getLogs` 优先

如果合约事件稳定，历史补账应优先：

- 直接按合约地址 + topic 拉日志
- 不再遍历每个块里的全部交易

这会显著降低：

- RPC 调用量
- 扫描耗时
- 漏识别概率

### 7.4 增加“干跑模式”

历史修复任务最好支持 dry-run：

- 只找异常，不改数据库
- 先输出将要补的记录清单
- 运维确认后再执行真正 repair

### 7.5 增加 repair report

每次历史补账都应输出：

- 扫描区块范围
- 找到的链上充值笔数
- 已存在 intent 数
- 新建 recovery intent 数
- 成功补账数
- 无法补账数及原因

这样后续才能审计。

## 8. 直接回答你的几个问题

### 8.1 “我修改 `lastScannedBlock` 会把之前用户充值了但是平台没有增加余额的补全吗？”

回答：**可能会，但不是一定。**

只有当那笔链上充值：

- 还能被 backfill 扫到
- 没有被错误地永久去重掉
- 能进入 confirm 或 repair 路径

才会补上。

### 8.2 “为什么？”

因为 `lastScannedBlock` 只是让 backfill 从更早区块重新扫描；它不会强制忽略：

- `processed_deposit_event_keys` 防重
- intent 当前状态
- 事件解析结果

所以它只是“重新给系统一次发现历史充值的机会”，不是“无条件补账”。

### 8.3 “如果要补全历史用户充值但是平台未到账该怎么做？”

回答：

1. 已知 `txHash` 时，优先 `replay_deposit_tx`
2. 只知道区间时，分段回拨 `lastScannedBlock` 做 backfill
3. 问题规模大时，单独做 `eth_getLogs` 历史补账脚本
4. 最后用 reconciliation 验证差额是否收敛到阈值内

### 8.4 “扫描用户打入智能合约的全部记录会消耗 gas 费用吗？”

回答：**不会消耗 gas。**

因为是只读 RPC，不发链上交易。但会消耗 RPC 配额、机器资源和时间。

### 8.5 “有没有什么好的方案？”

回答：

- 日常运行继续用现在的 `pending confirm + backfill + reconciliation`
- 历史大规模修复单独做 `eth_getLogs` 驱动的 repair job
- 支持 dry-run + repair report
- 已知单笔问题优先按 `txHash replay`

这是成本、可控性、审计能力三者之间最平衡的方案。
