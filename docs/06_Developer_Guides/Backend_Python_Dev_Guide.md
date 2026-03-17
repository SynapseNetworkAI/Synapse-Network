# Backend Python Development Guide

本文档说明如何启动和调试 Synapse Platform Gateway 本地开发环境。

## 1. 环境准备

```bash
cd gateway
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 2. 推荐本地启动方式

在仓库根目录执行：

```bash
sh scripts/local/setup_local_env.sh
```

该脚本负责：

1. 启动本地链或本地依赖
2. 部署合约并写入 contract config
3. 启动 Platform Gateway
4. 启动相关前端

## 3. 当前本地主链路

1. Owner 完成入金
2. Gateway Indexer 识别充值事件
3. Agent 通过 Gateway 发起调用
4. Provider endpoint 被平台转发调用
5. Gateway 完成原子结算和审计

## 4. 单独调试 Gateway

```bash
cd gateway
python3 seller_fastapi.py
```

说明：当前入口文件名仍是历史实现名，但业务角色语义已经是 Platform Gateway，不应再把这个文件名理解为产品角色定义。

## 5. 常见调试任务

1. 调试入金 intent 和确认状态
2. 调试 discovery / quote / invoke
3. 调试 provider routing 与健康探测
4. 调试 provider withdrawal 风控与审核状态

## 6. 开发原则

1. 任何后端行为变化都必须同步更新测试和文档
2. 关键资金路径必须优先验证事务、幂等、锁和审计
3. 不要再把旧角色命名当作架构中心
