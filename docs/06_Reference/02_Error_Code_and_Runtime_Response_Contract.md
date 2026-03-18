# Error Code and Runtime Response Contract

## 1. 目标

本文件定义 Synapse 面向 Agent Runtime 的统一错误响应表面，以及错误码的稳定使用规则。

## 2. 统一错误响应结构

当前 Gateway 对外错误响应应统一为：

1. 顶层 `detail`
2. `detail.code` 作为稳定机器语义
3. `detail.message` 作为人类调试信息

Agent、SDK、前端和测试断言都应优先依赖 `detail.code`，而不是自然语言 message。

## 3. 错误码分层

当前错误码按四层理解最稳定：

1. Request Layer
2. Credential Layer
3. Quote / Invocation Layer
4. Execution Layer

## 4. 常见错误类别

### 4.1 Request Layer

典型问题包括：

1. prompt 为空
2. prompt 过长
3. serviceId 缺失或格式非法
4. requestId 非法
5. 必填字段缺失

### 4.2 Credential Layer

典型问题包括：

1. credential invalid
2. credential inactive
3. credential expired
4. max calls exceeded
5. rpm exceeded
6. credit limit exceeded

### 4.3 Quote / Invocation Scope Layer

典型问题包括：

1. quote not found
2. quote credential mismatch
3. quote expired
4. quote not invokable
5. idempotency conflict
6. invocation forbidden

### 4.4 Budget / Execution Layer

典型问题包括：

1. budget exhausted
2. daily limit exceeded
3. per invocation cap exceeded
4. service unavailable
5. upstream error
6. insufficient balance

## 5. Runtime 推荐处理策略

### 5.1 不应自动重试的错误

1. credential invalid / inactive / expired
2. budget exhausted
3. daily limit exceeded
4. per invocation cap exceeded
5. idempotency conflict

### 5.2 应先修复请求再重试的错误

1. required fields missing
2. invalid request id
3. invalid service id format
4. payload too large

### 5.3 可退避重试的错误

1. service unavailable
2. upstream error
3. credential rpm exceeded
4. service qps exceeded

## 6. 兼容规则

错误码治理必须遵守：

1. 新增错误码允许，但必须补实现、文档和测试
2. 删除或重命名错误码禁止，除非做版本升级
3. 同一语义不得在不同接口上发明不同名字

## 7. 文档结论

Synapse 的错误码不是调试附属品，而是 Agent Runtime 的控制信号。

谁绕开稳定错误码去写集成，谁就会把 SDK、前端和自动化编排一起写碎。