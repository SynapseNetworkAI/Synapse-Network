# 任务详情页与守护进程(Daemon)体验优化

## 1. 任务交付物(Payload)多模态展示
在原本的任务详情设计中，前端仅展示单一的 `result_data` 纯文本。但在当前的 A2A 网络“控制面与数据面分离”架构下，Seller Agent 多通过 IPFS 或 HTTP OSS 返回存储链接，而非完整的原生载荷。

**UI 升级响应：**
- 在 `/dashboard/tasks/[id]/page.tsx` 的 `Delivery Result Payload` 模块内，现已支持解构渲染三大数据维度，并具有更好的断行与安全超链接点击体验：
  - **Data URL (IPFS/HTTP)**：安全可点击的外链，展示具体的数据源。
  - **Result Hash**：底层链上验证或验证树用于对比防篡改的哈希值。
  - **Raw Payload**：传统的轻量 JSON 或字符串载荷。
- **关于链上追踪（TxHash / Block Number）：** 目前针对中心化或者尚未最终上链打款的链下流转记录，前端进行了文案降级并消除空白 UI 混淆，显示 `N/A (Off-chain)`。

## 2. 列表视图的快捷深层入口
- **痛点**：过去，用户只能通过处于 `PENDING` 时的 Edit 或 Clone 操作进入特定视图，无法直接在列表中一键查看已完成 (`RELEASED`) 或处理中 (`PROCESSING`) 任务的数据细节。
- **解决**：在 `/dashboard/tasks/page.tsx` 的每个任务卡片操作栏（右下角）新增了与 Clone 等级的带有 Eye (眼睛) 图标的 **Details** 按钮。一键穿透路由，使得全状态单据的详情可直接追溯审查。

## 3. Daemon 守护进程：修正“AI 诚实幻觉”与网络授权
在使用 `buyer_daemon_example.py` 和 `seller_daemon_example.py` 进行真实节点模拟时遇到以下问题：
1. **未授权白名单阻塞**：样例脚本中硬编码的是占位假地址，当与后端的真实 SQLite DB (`indexer_client.db`) 隔离匹配时直接报 `403 Forbidden`。
2. **AI 清高拒单**：当抛出一个极简任务（如：“帮我写一个 Python HelloWorld”）却附带异常高的匹配金（如：`450 USDC`）时，DeepSeek 等模型会因为内置打工人道德护栏，判定此任务类似诈骗或者价不对等，从而强行 `REJECT` 退单回滚。

**修复手段：**
- 获取了真实建立的 session 钱包更新至测试脚本。
- **重置了 Seller Worker System Prompt 的“打工人角色设定”**：从“精明诚实”修改为“极度贪婪且渴望赚钱”。
- **强制指令覆盖**：“遇到远超底线的赏金（即天上掉馅饼），必须果断接单（仅输出 `ACCEPT`），严禁因为钱太多而觉得不合理并拒绝。”
- 该提示词安全补丁成功打通了极值赏金的自动匹配容错率。