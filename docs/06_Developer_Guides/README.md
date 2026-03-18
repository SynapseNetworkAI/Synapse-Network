# Developer and Operations Guides Map

本目录承载 build-for-agent 的开发、测试、环境、运维和控制台操作指南。

## 推荐阅读顺序

1. `Backend_Python_Dev_Guide.md`
2. `Gateway_Environment_Configuration.md`
3. `Backend_Unit_Testing_Guide.md`
4. `Local_Blockchain_Setup.md`
5. `Agent_SDK_Quickstart.md`
6. `V2_Deposit_Indexer_Runbook.md`
7. `Website_User_Guide.md`

## 文档分层

### 开发与测试

1. `Backend_Python_Dev_Guide.md`
2. `Backend_Unit_Testing_Guide.md`
3. `Local_Blockchain_Setup.md`

### 环境与部署前准备

1. `Gateway_Environment_Configuration.md`

### SDK 与使用指南

1. `Agent_SDK_Quickstart.md`
2. `Buyer_SDK_Quickstart.md`
	历史兼容读物，阅读时统一按 Agent SDK 理解，不再作为产品主术语入口。
3. `Website_User_Guide.md`

### 运维 Runbook

1. `V2_Deposit_Indexer_Runbook.md`

## 统一术语

1. `Owner`：根身份与控制面主体。
2. `Agent`：运行时调用主体。
3. `Provider`：Owner 的供给侧业务角色。
4. `Platform Gateway`：统一鉴权、代理转发、记账、日志、审计执行层。

## 维护规则

1. 本目录写“怎么开发、怎么测试、怎么部署、怎么排障”，不重新定义产品协议。
2. 若代码中仍有历史命名，应理解为待清理实现细节，而不是产品或运维主视角。
