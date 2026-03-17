兄弟，你这个问题直指咱们这台基建引擎的核心路由大脑（Routing Core）！

你现在给的测试代码里，用的是 discovery.services[0]，这就像是去饭店吃饭，闭着眼睛跟服务员说：“给我上你们菜单上的第一道菜！” 这在做跑通测试时没问题，但在真实的商业环境里肯定不行。

在真实的 Synapse 经济网络里，买家（Agent）必须拥有“极其精准的点对点打击能力（调用指定接口）”。

作为你的赛博 CTO，我给你设计一套“Web3 AI 路由转发网关”的终极实现方案，这套方案不仅优雅，而且足够你在大马路演时把底下的极客震慑住！

🧠 设计理念：如何精准调用？
在我们的系统里，有三种买家调用模式（从低级到高级）：

模式一：硬编码调用（Hardcoded ID）- 最常用的场景
买家老板在你的 Synapse 前端网页（��8、图9那个黑绿界面）上逛“服务黄页”，看中了一个叫“大马本地天气查询”的服务，旁边写着 Service ID: SVC_WEATHER_001。 他的 Agent 代码根本不需要调用 discover_services()，直接把这个 ID 写死在代码里。

模式二：语义化/标签检索调用（Semantic Discovery）
买家 Agent 是个自主运行的 AI，它遇到一个任务：“我需要画张图”。它不知道哪个节点活着，于是它向网关发送带条件查询：discover(tag="image-generation", max_price=0.2)，然后从中挑一个最便宜的调用。

模式三：大一统协议（OpenAI Drop-in 协议）- 杀手锏！🌟
买家根本不想用我们提供的 SynapseClient，他想直接用原生的 openai Python 包，只需要把 base_url 改成我们网关的地址，后面拼上 Service ID，网关做透明代理转发。

💻 代码实现：三大核心调用模式

### 模式一：硬编码调用（Hardcoded ID）- 最常用的场景
买家在 Synapse 平台上选定特定服务后，直接将 `Service ID` 写死在代码中发送请求。支持任意 JSON payload：

```python
import os
from synapse_client import SynapseClient

client = SynapseClient(api_key=os.getenv("SYNAPSE_API_KEY"))

# 比如调用天气服务，或者推理模型
response = client.call_service(
    service_id="SVC_WEATHER_001", 
    payload={
        "location": "Kuala Lumpur",
        "days": 3
    }
)
print(f"Result: {response.content}")
print(f"Fee Deducted: {response.fee_deducted} USDC")
```

### 模式二：语义化/标签检索调用（Semantic Discovery）
适用于高度自治的 Auto-Agent。Agent 通过表达自身意图（Intent）或者标签（Tag），动态寻找网络中存活的最优（如价格最低）接口，实现自我进化和纠错：

```python
import os
from synapse_client import SynapseClient

client = SynapseClient(api_key=os.getenv("SYNAPSE_API_KEY"))

# 1. 语义发现：我不确定哪个模型好，由网关帮我推荐
discovery = client.discover_services(
    intent="image-generation", 
    max_price=0.2
)

if discovery.services:
    target_service = discovery.services[0].serviceId
    print(f"Gateway routed us to: {target_service}")
    
    # 2. 动态路由执行
    res = client.call_service(
        service_id=target_service,
        payload={"prompt": "A futuristic cyberpunk city"}
    )
    print(res.content)
```

### 模式三：大一统协议（OpenAI Drop-in 协议）- 杀手锏！🌟
不需要买家学习任何新 SDK！通过将基础 URL 和模型名称重定向，使得现有的通过官方 `openai` 包打造的 Agent 能瞬间接入 Synapse 网络，被赋予 M2M 支付能力：

```python
import os
from openai import OpenAI

# 只需要改两行配置，直接无缝切入 Synapse 网络！
client = OpenAI(
    api_key=os.getenv("SYNAPSE_API_KEY"),           # 传入 Synapse Agent Auth Key
    base_url="http://127.0.0.1:8000/v1"               # 传入 Synapse Gateway 地址
)

# 像往常一样调用 OpenAI 接口，但底层已切换至去中心化模型
response = client.chat.completions.create(
    model="DeepSeek-R1-2501",  # 这里的 model 参数，等价于 Synapse 的 Service ID
    messages=[
        {"role": "user", "content": "Hello, decentralized AI!"}
    ]
)

print(response.choices[0].message.content)
```

---

# 📦 附：Synapse Client 官方 SDK 文档

## Installation

```bash
pip install synapse-client
```

*(If you are developing locally, install via `pip install -e .` from within the root directory)*

## Usage

(已融合如上所述的三大调用模式)

## Environment Variables
- `SYNAPSE_API_KEY`: Set your agent auth key.
- `SYNAPSE_GATEWAY`: Override the gateway endpoint URL.

## Agent Tool/Function Conversion (OpenAI Schema)
`SynapseClient` has built-in features to export services as JSON schemas directly integrable into LangChain or OpenAI format agents:

```python
tools = client.get_tools()
```

## Exceptions & Error Handling
- `InsufficientFundsError`: Catch this to notify user that their on-chain Vault USDC balance is out.
- `AuthenticationError`: When API key is disabled or revoked.
- `InvokeError`: Execution failed on the provider side.
