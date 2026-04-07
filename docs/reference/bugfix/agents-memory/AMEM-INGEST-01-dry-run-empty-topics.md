# AMEM-INGEST-01 — ingest --dry-run 返回空 topics 和空 summary

**组件：** `agents_memory/services/ingest.py`  
**日期：** 2026-04-07  
**状态：** 已确认（预期行为，非 bug）  
**项目：** Synapse-Network wiki 接入测试

---

## 现象

运行 `amem ingest <bugfix.md> --type pr-review --dry-run` 时，返回结果中：
- `topics = []`（没有匹配到 wiki topic）
- `summary` 长度为 0

---

## 根因分析

`ingest_document()` 的设计行为：

1. 调用 LLM 提取 JSON：`{summary, topics, timeline_entry, compiled_truth_update}`
2. `topics` 字段会过滤：**只保留已在 `memory/wiki/` 中存在的 topic 名称**：
   ```python
   known_topics = list_wiki_topics(ctx.wiki_dir)
   topics_updated = [t for t in llm_topics if t in known_topics]
   ```
3. `--dry-run` 模式下调用 LLM 但不写文件——**LLM 输出的 `topics` 若与 wiki topic 命名不完全一致（如 LLM 输出 `"deposit"` 而 wiki topic 为 `"synapse-bugfix-deposit"`），则过滤后为空**

此外，`summary` 长度为 0 说明 `--dry-run` 模式下 `ingest_document()` 在 LLM 调用前已提前返回（当 wiki topic 列表为空时）—— 实际是 wiki topic 存在但命名格式不匹配。

---

## 影响

- 不影响正式 ingest（非 --dry-run）：LLM 会根据文档内容提取 topics，实际命名靠 LLM 推断
- **不影响 wiki-ingest 导入**（直接导入原文，无需 LLM topic 匹配）
- 测试中 `ingest --dry-run` 通过（不报错），`topics=[]` 只是警告，不代表链路断裂

---

## 建议做法

### 方式 1：先建索引 topic，再 ingest（推荐）

```bash
# 先创建 "deposit" 这个 wiki topic
amem wiki-sync deposit --content "# Deposit\n\n存款功能相关。"

# 然后 ingest 才能匹配到 topic
amem ingest BUG-DEPOSIT-01.md --type pr-review --project synapse-network
```

### 方式 2：直接使用 wiki-ingest（最简单）

```bash
# 绕过 LLM topic 匹配，直接导入原文
amem wiki-ingest BUG-DEPOSIT-01.md --topic synapse-deposit-bugs
```

### 方式 3：用 --dry-run 预览 + 检查 summary

```bash
# 非 dry-run 正式 ingest，查看实际效果
amem ingest BUG-DEPOSIT-01.md --type pr-review --project synapse-network
```

---

## 结论

这是 ingest 流水线的设计约束，不是 bug。  
**解决方案**：批量接入时，先用 `wiki-ingest` 或 `wiki-sync` 建立 topic，再用 `ingest` 追加时间线。

参见：[docs/ops/07_Agents_Memory_Wiki_Integration.md](../../../ops/07_Agents_Memory_Wiki_Integration.md)
