# Synapse Network: 卖家工作空间 (Seller Workspace) 设计文档

## 1. 核心定位与设计目标

* **核心定位**: 为提供算力、模型API或数据接口的 AI Agent/开发者（卖家）提供的一站式基建控制台。
* **设计目标**: 
  1. **零门槛认知**: 让卖家一进页面就能看懂：接入非常简单、这玩意能赚钱、提现毫无障碍。
  2. **无需拦截 (Un-gated)**: 允许未连接钱包的用户进入看“热闹和教程”，只在真正需要操作链上数据或生成密钥时强制拦截 (`Connect Wallet`)。
  3. **架构对偶性**: 与买家(Buyer)工作空间的“三步走”设计语言保持高度对称与极客风格。

## 2. 页面路径与全局 Layout

* **路由**: `/dashboard/sell`
* **未登录状态表现**: 
  * 右上角显示原生的 `Connect Wallet` 的高亮发光按钮。
  * 页面主体内容（接入步骤、代码演示、假数据统计盘）完全可见。
  * 所有的交互按钮（如 `Register Service`, `Withdraw`）显示为 `Connect Wallet to Action` 或者置灰，鼠标悬浮时提示“请先链接钱包”。
* **视觉语言**: 延续 `Matrix & Cyberpunk`，黑灰底色，极客荧光绿点缀，强调控制台（Developer Console）和数据仪表盘的基建感。

## 3. UI/UX 模块设计 (自上而下)

### 第 1 模块：Hero Section & 核心数据看板 (KPI Board)
页面顶部的横幅与核心财务指标。如果是未登录状态，显示 “XX 万 USDC 已在网络中结算” 的全局数据或全部为 0；登录后显示个人的真实收益。

* **Headline**: `Monetize Your AI APIs` 
* **Subtitle**: 只需 3 行命令，将你的本地 FastAPI / Agent 变现。零 Gas 扣费，极速结算到链上 Vault。
* **KPI Metrics (4个金刚位数据)**:
  1. **Life-Time Earnings (历史总收入)**: 绿色的数字，比如 `1,245.50 USDC`
  2. **Unclaimed Balance (待提现余额)**: `305.00 USDC` -> 附带一个发光的 `Claim / Withdraw` 按钮。
  3. **Total API Calls (总计调用次数)**: 显示服务被全网买家调用的总次数。
  4. **Active Services (运行中的节点数)**: `2 Online` 伴随呼吸灯动画。

### 第 2 模块：极简 onboarding 的 "四步走" 指南 (How to Earn)
为了让卖家知道“怎么接入，怎么赚钱”，直接在页面核心区域放置横向流水线卡片。这是降低教育成本的核心。

* **Step 1: Generate API Secret (获取网关签名密钥)**
  * *文案*: 平台为你的 Web3 钱包签发全局唯一的 `API_Secret_Key`，这是你后续防止被“白嫖”调用的核心凭证。
  * *操作*: 引导卖家进入 API Secrets 页面生成并复制密钥。
* **Step 2: Setup Gateway & Security (配置本地网关与防白嫖鉴权)**
  * *文案*: 使用我们的 Python/Node SDK 包装你原本的接口逻辑，基于 HMAC-SHA256 无情拦截所有绕过平台的裸调流量。
  * *展示*: 提供一个黑色高亮的纯文本代码块（Code Snippet），演示如何混入鉴权中间件。
* **Step 3: Register AI-Native Service Manifest (发布 AI 友好型服务清单)**
  * *文案*: 直接向网络发布 Manifest，声明你的端点(`endpoint`)、调用价格、工具标识及意图标签，买方大模型可自动嗅探并消费你的接口。
  * *AI 降维能力*: 买家无需硬编码对接，一键实现 Zero-Code 自动发现。
* **Step 4: Earn & Request Settlement (持续获利与提现清算)**
  * *文案*: 随着调用量增加，你的收益数据实时在本地记账累积。随时一键将账单提交到链上 Vault，全额提取真实的 USDC 到钱包。

### 第 3 模块：服务与凭证管理 (My Manifests & Services)
卖家拥有的已发布服务列表（取代原本的 `/dashboard/services` 单独页面，直接作为控制台下半部分，用于管理其全网路由突触及鉴权密钥）。

* **Grid Table**: 已经发布的 Service 列表。
* **主要列**:
  * `Service & Tool Name` (如 `DeepSeek-Chat` | Tool: `get_deepseek_chat`，并附带小字 `Intent` 标签池)
  * `Endpoint & Health` (主业务 URL 和 `health_check` 探活状态。如果探活长时失联，会给卖家发警告提示可能遭到下架)
  * `QoS & Pricing` (如 0.05 USDC/Call，最大承载并发 50 QPS)
  * `Status` (Online / Offline 带绿色呼吸灯)
  * `Actions` (View Secret Key 查看看门密钥, Metrics 数据图表, Edit 修改配置)

### 第 4 模块：实时流水流(Event Stream) & 提现
* **流水表 (Income Ledger)**: 
  * 包含买家调用了什么服务，付了多少钱，平台扣了手续费，净赚多少 (Net Earned)。
  * 状态标识：`Local Recorded` -> `Settling` -> `On-chain Confirmed`。

## 4. 前端交互状态流转 (UX Flow)
1. **游客访问**: 空降 `/dashboard/sell` -> 看到大屏字，酷炫的 SDK 代码片段，和 "三步走" 引导流程。
2. **连接动作**: 点击随意区域的灰化按钮 `Connect Wallet` -> 触发右上角钱包唤醒。
3. **连接与登录会话合并**: 钱包连接成功后，前端会自动尝试完成一次 Session 授权（Sign-In）。若自动授权失败，用户可手动重试，避免“已连接但不可操作”的割裂体验。
4. **已连接 & 第一次来**: 卡片上方提示：`Welcome! You are 1 step away from earning.`，强引导用户进入 **Step 1** (Publish Service)。
5. **会话过期策略（卖家）**: Provider 与 Buyer 保持一致。若检测到 Session 过期，系统会主动断开当前钱包连接，用户必须重新连接钱包并重新建立 Session 才能继续执行写操作。
6. **Secrets 页面访问策略**: `/provider/secrets` 允许未登录访问；未连接钱包或无 Session 时仅展示空列表。点击 `Create new secret key` 时，系统先触发钱包连接与 Session 授权，成功后再打开创建弹窗。
7. **成熟卖家（有服务正在跑）**: 第一眼就能看到 **KPI 收益图表** 和 **服务列表的状态**，重点操作是点击提现。
## 5. “降维打击”：基于 cURL 与响应结果的零代码 AI 一键发版 (Zero-Shot Manifest Auto-Generation)

### 5.1 业务痛点
传统 API 平台中，上架服务需要填写极其繁琐的 OpenAPI 规范，手动定义每个字段的类型、长度、描述。很多“野生” AI 开发者或拥有现成接口的数据服务商不具备编写标准 Schema 的耐心，这极大地拉高了“卖家接入势能”。

### 5.2 解决方案理念 (The AI-Native Approach)
**"用 AI 的方式打败 API 墙"**。
卖家只需要将平时用来测试业务的 `cURL` 请求命令，以及控制台打印出来的 JSON 响应结果，直接原样粘贴到网关控制台。我们将接入多模型路由后端库管理（支持 DeepSeek / OpenAI / Anthropic 等多通道切换），通过智能体自动逆向解析这些脏数据，实现 10 秒内填充满血版的 Service Manifest。

### 5.3 用户操作流转 (User Flow)
1. **呼出功能**: 卖家在注册 Manifest 表单页面，点击 **"🪄 AI Auto-Gen"**。弹出配置模态框。
2. **填写语料**: 弹出一个框（左侧输入 cURL Command，右侧输入 Expected JSON Response），底部为配置通道（如选择使用的底层模型，目前为 DeepSeek）。
3. **黑盒推理**:
    * 提取到目标 Endpoint URL 与 Method。
    * 解析出 URL Query Params 与 JSON Body，倒推逆向生成 `input_schema`。
    * 解析 JSON Response，逆向推导 `output_schema`。
    * LLM 基于上下文的意图内容，自动脑补中英文双语的 `agent_tool_name` (符合 OpenAI Function calling 正则) 和 `description`，甚至自动总结归纳出 `intent` 匹配词 (如 weather, quotes)。
4. **一秒落盘**: 提取完成的对象自动刷入前端 React Form State，右侧终端预览瞬间完成 JSON 的高亮编译，接着卖家一键确认即可上链发版。

### 5.4 后端多模型架构 (Multi-Model Parser Gateway)
为了防止某个底座大模型（如 DeepSeek）宕机，网关侧（FastAPI）需预留路由模块 (`POST /api/v1/services/manifest/auto-gen`)：
请求参数包含：
```json
{
  "curl_command": "curl -X POST ...",
  "response_body": "{\"input_text\":\"关于坚持\"...}",
  "preferred_model": "deepseek-chat" // 预留模型选项：openai-gpt4 / deepseek-coder 等
}
```
* **系统提示词 (System Prompt) 设计与实现**:
为了确保大模型能够“Zero-Shot（零样本）”生成完美匹配平台网关 `api_gateway_reverse_proxy_design.md` 所定义的 `ServiceManifest`，并且包含所有必填要素（路由、意图、计费、输入输出Schema），请在你的调用底层（如 DeepSeek、GPT-4）网关时，使用如下 **System Prompt**：

```text
你是一个世界级的 API 到大模型 Agent 之间通讯协议的逆向架构师。
你的任务是将开发者随意提供的“Raw cURL 命令”和“Expected JSON Response (可选)”解析，并逆向工程转换成一份严格的 Web3 兼容的『Agent-Native Service Manifest』JSON 档案。

# 核心规则:
1. 绝对强制返回纯 JSON，不要有任何思考过程、Markdown 语法或多余说明。你吐出的结果必须能被直接 JSON.parse() 解析。
2. 提取 URL、Method、Headers 和 Body 逻辑，并将数据结构严格转换为符合 JSON Schema 规范的 `input_schema`。
3. 从 Response 中提取字段，转换为符合 JSON Schema 的 `output_schema`。
4. 基于你的全知大模型理解能力，自动脑补：
   - 适当填补 service_name, agent_tool_name (必须只包含 a-z,0-9,_, 长度1-64)
   - description (必须说明触发条件，如“当用户想要查询xx时调用，支持xx参数”，以利于Agent理解)
   - intent 标签 (3-5个关于它能提供的能力的SEO或语义短语组成的数组)

# 标准输出示范依据 (必须包含下列结构，不得遗漏):
{
  "service_id": "svc_7f8a9b2c1...", 
  "version": "1.0.0",
  "service_name": "Inspiring Quotes API",
  "agent_tool_name": "get_inspiring_quotes", 
  "description": "用于检索名言警句。当用户情绪低落、面临挑战或明确要求提供鼓励性名言时，调用此工作流。",
  "intent": ["名人名言", "quotes", "motivation"],
  "endpoint": "https://seller.ai-domain.com/api/v1/quotes",
  "health_check": "https://seller.ai-domain.com/api/v1/health",
  "pricing": {
    "currency": "USDC",
    "amount": "0.01",
    "type": "per_call"
  },
  "constraints": {
    "max_response_bytes": 2048,
    "timeout_ms": 3000,
    "max_qps": 50
  },
  "input_schema": {
    "type": "object",
    "properties": {
      "text": { 
        "type": "string", 
        "description": "用户的提示词需求",
        "maxLength": 200
      },
      "category": {
        "type": "string",
        "description": "名言的对应分类领域。必须从选项中选择其一：'crypto'(加密)、'life'(生活)、'business'(商业)",
        "enum": ["crypto", "life", "business"]
      }
    },
    "required": ["text", "category"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "quote": { "type": "string", "description": "获得的名言文本" },
      "author": { "type": "string", "description": "名言作者" }
    }
  }
}
```



## 6. 开发实现状态追踪 (Implementation Status)

- [x] **方案设计文档落地**: 完成了 AI Auto-Gen 零代码一键发版特性的规划、业务流转及后端多模型架构设计文档梳理并且落地。
- [x] **前端 UI 和交互全量实现**:  完全重构，支持 Draft 本地缓存功能、补全 Output Schema 定义、搭建原生拟真 AI 智能体弹窗交互闭环以及基于 cURL 预检的 React Form 回填功能。
- [ ] **后端 AI 解析路由落地**: 实现 FastAPI Gateway ()，对齐大模型底层 Prompt，返回精准结构体。

## 6. 开发实现状态追踪 (Implementation Status)

- [x] **方案设计文档落地**: 完成了 AI Auto-Gen 零代码一键发版特性的规划、业务流转及后端多模型架构设计文档梳理并且落地。
- [x] **前端 UI 和交互全量实现**: 前端 `deploy/page.tsx` 完全重构，支持 Draft 本地缓存功能、补全 Output Schema 定义、搭建原生拟真 AI 智能体弹窗交互闭环以及基于 cURL 预检的 React Form 回填功能。
- [ ] **后端 AI 解析路由落地**: 实现 FastAPI Gateway，对齐大模型底层 Prompt，返回精准结构体。
