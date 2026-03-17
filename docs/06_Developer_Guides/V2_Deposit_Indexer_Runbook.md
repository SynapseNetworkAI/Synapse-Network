# Deposit Indexer Runbook

本文说明充值索引器、历史补扫和对账任务如何共同保证 Owner 入金与平台账本一致。

## 1. 模块职责

1. `chain`: 读取链上事实
2. `processing`: 把链上事实推进为账本状态
3. `backfill`: 补扫历史区块
4. `reconciliation`: 对比链上 vault 与平台账本义务
5. `runner`: 调度循环和管理员 replay 能力

## 2. 一致性目标

平台追求的是：

1. 入金先进入 `consumer_pending`
2. 确认后原子迁移到 `consumer_available`
3. backfill 用于找回漏扫交易
4. reconciliation 用于发现账本与链上义务偏差

## 3. `lastScannedBlock` 的意义

`lastScannedBlock` 是历史补扫游标，不是余额真相源。

它的作用是：

1. 标记 backfill 扫到哪里
2. 支持服务重启后继续扫描
3. 支持人工触发补扫窗口

## 4. 运维结论

1. 改小 `lastScannedBlock` 只是允许重新扫描历史区块
2. 能否真正补账，还取决于 event 去重状态、intent 状态和链上事实是否可解析
3. 生产修复必须优先通过 replay / backfill / reconciliation 的正式路径完成，而不是手工改余额
