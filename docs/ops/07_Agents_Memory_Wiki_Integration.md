---
title: "Agents-Memory Wiki 接入指南"
project: synapse-network
updated_at: 2026-04-07
---

# Agents-Memory Wiki 接入指南

## 概述

本文档说明如何将已有项目的文档（设计文档、bugfix 记录、架构文档）接入 Agents-Memory，自动生成结构化 wiki 知识库，供 AI Agent 和开发者查询。

适用项目：任何包含 Markdown 文档的项目仓库。  
参考项目：`/Users/cliff/workspace/agent/Synapse-Network`

---

## 前提条件

### 1. Agents-Memory 安装就绪

```bash
# 验证 amem 可用
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem --help

# 或通过 install-cli.sh 安装全局命令
bash /Users/cliff/workspace/agent/Agents-Memory/scripts/install-cli.sh
amem --help
```

### 2. Ollama 服务运行

```bash
# 检查 Ollama 状态
curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); print([m['name'] for m in d['models']])"

# 如未安装，运行一键安装
bash /Users/cliff/workspace/agent/Agents-Memory/scripts/install-models.sh
```

要求已安装：
- `nomic-embed-text`（embedding）
- `qwen2.5:7b`（LLM 合成，也可换 `gemma4:e4b`）

### 3. 配置环境变量

```bash
export AMEM_EMBED_PROVIDER=ollama
export AMEM_LLM_PROVIDER=ollama
export AMEM_LLM_MODEL=qwen2.5:7b
export OLLAMA_HOST=http://localhost:11434
export AGENTS_MEMORY_ROOT=/Users/cliff/workspace/agent/Agents-Memory
```

---

## 两种接入方式

### 方式 A：wiki-ingest 直接导入（推荐快速接入）

适合将已有 Markdown 文档直接导入 wiki，保留原文结构：

```bash
# 将单个文档导入为 wiki topic
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-ingest \
  /Users/cliff/workspace/agent/Synapse-Network/docs/ARCHITECTURE.md \
  --topic synapse-architecture

# 将 bugfix 记录导入
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-ingest \
  /Users/cliff/workspace/agent/Synapse-Network/docs/reference/bugfix/gateway/BUG-DEPOSIT-01-intent-status-false-failed.md \
  --topic synapse-deposit-bug
```

**结果**：`memory/wiki/<topic>.md` 文件创建，供 `amem wiki-query` 检索。

---

### 方式 B：ingest 结构化提取（推荐中长期接入）

适合提取文档要点，更新 wiki 知识库，LLM 提炼核心模式：

```bash
# Ingest 一个 bugfix 记录（从文档提取 summary + timeline_entry + topics）
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem ingest \
  /Users/cliff/workspace/agent/Synapse-Network/docs/reference/bugfix/gateway/BUG-DEPOSIT-01-intent-status-false-failed.md \
  --type pr-review \
  --project synapse-network

# --dry-run 预览不写文件
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem ingest \
  /Users/cliff/workspace/agent/Synapse-Network/docs/reference/bugfix/gateway/BUG-DEPOSIT-01-intent-status-false-failed.md \
  --type pr-review \
  --project synapse-network \
  --dry-run
```

**结果**：匹配的 wiki topic 时间线更新，`memory/ingest_log.jsonl` 追加记录。

---

## 自动化批量接入脚本

使用 Synapse-Network 提供的一键脚本：

```bash
# 批量接入所有 bugfix 文档到 wiki
bash /Users/cliff/workspace/agent/Agents-Memory/scripts/gen-synapse-wiki.sh

# 测试接入后的整条链路
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/test-synapse-wiki.py
```

---

## Wiki 生成流程

```
Synapse-Network docs/
  ├── ARCHITECTURE.md           → wiki topic: synapse-architecture
  ├── docs/reference/bugfix/
  │   ├── gateway/*.md          → wiki topic: synapse-gateway-bugs
  │   ├── gateway/billing/      → wiki topic: synapse-billing
  │   ├── gateway/discovery/    → wiki topic: synapse-discovery
  │   └── ...                   → 各子领域 topic
  └── docs/ops/*.md             → wiki topic: synapse-ops-*
                │
                ▼
  amem wiki-ingest (每个文档)
                │
                ▼
  memory/wiki/<topic>.md 创建
                │
                ▼
  amem wiki-compile <topic> --provider ollama
                │
                ▼
  compiled_truth 由 LLM 提炼
                │
                ▼
  amem wiki-lint  → 健康检查
```

---

## wiki-compile — LLM 提炼知识

将导入的原始文档提炼为 compiled_truth（中文执行摘要 + 已知 Pattern）：

```bash
# 提炼单个 topic
AMEM_LLM_PROVIDER=ollama AMEM_LLM_MODEL=qwen2.5:7b \
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-compile synapse-architecture

# 预览不写文件
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-compile synapse-architecture --dry-run

# 指定模型（质量更高）
AMEM_LLM_MODEL=qwen2.5:14b \
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-compile synapse-architecture
```

---

## wiki-query — 查询知识库

```bash
# 关键词搜索所有 wiki topics
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-query "deposit intent status"

# 列出所有 topics
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-list

# 健康检查
python3.12 /Users/cliff/workspace/agent/Agents-Memory/scripts/amem wiki-lint
```

---

## MCP 工具查询（在 VS Code Copilot 中）

接入后，AI Agent 可通过 MCP 工具查询 Synapse-Network 知识库：

```
memory_wiki_query("synapse deposit bug")
memory_search("JWT token expiry")
memory_wiki_lint()
```

---

## 持续维护建议

1. **新 bugfix 提交后**：`amem ingest <bugfix.md> --type pr-review --project synapse-network`
2. **架构设计更新后**：`amem wiki-ingest <design.md> --topic synapse-architecture`
3. **每周 wiki-compile**：`amem wiki-compile synapse-architecture --provider ollama`
4. **CI 集成**：在 GitHub Actions 中运行 `python3.12 scripts/test-synapse-wiki.py --quick`

---

## 常见问题

### Q: ingest 后 topics 为空？

`ingest` 只更新已有 wiki topics。需先用 `wiki-ingest` 或 `wiki-sync` 创建 topic：

```bash
amem wiki-sync synapse-network --content "# Synapse Network\n\n核心服务。"
amem ingest <file> --type pr-review --project synapse-network
```

### Q: wiki-compile 报 "no error records found" / "skipped"？

这是正常行为（wiki-compile 依赖 errors/ 目录中的记录）。若无错误记录，直接用 `wiki-ingest` 导入文档即可。

### Q: Ollama 调用超时？

```bash
# 检查 Ollama 是否在运行
curl -s http://localhost:11434/api/tags
# 重启 Ollama
ollama serve
```
