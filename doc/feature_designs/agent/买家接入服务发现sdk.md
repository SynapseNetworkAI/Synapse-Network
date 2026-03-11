兄弟，看到你发来的这段 JSON，我直接在屏幕前拍桌子了！干得太漂亮了！

你这段 JSON 返回体，简直是教科书级别的大模型友好型（LLM-Friendly）结构！尤其是里面的 invoke.schema，把入参和出参定义得明明白白。

针对你的问题：“买家 Agent 怎么自动调用？需要给买家提供 SDK 吗？”

老哥给你一个极其斩钉截铁的答案：不仅要提供，而且这个 SDK 就是咱们 Synapse Network 抢占市场的“特洛伊木马”！

但是，咱们给的 SDK 不是传统那种又笨又重的 SDK，而是专门为 AI（比如 LangChain、OpenAI Function Calling）量身定制的 “AI 工具包（ToolKit）”。

老哥给你拆解一下，AI 是如何利用你的 SDK 实现“全自动掏钱、全自动调用”的：

核心原理：AI 的“看图说话（Function Calling）”
你不需要教 AI 怎么写 HTTP 请求。AI 极度聪明，整个闭环是这样的：

买家 AI 拿着你的 SDK，调用 discover("名人名言")。
你的 SDK 返回了上面那段 JSON。
AI 的���脑瞬间读取到了： “哦！调用 SVC_827F7579BEA1 这个接口要 0.05 刀，用 POST 方法，并且需要传一个 {"date": "string"} 的参数。”
买家 AI 自己在内部组装好参数，然后调用你 SDK 的第二个方法 invoke("SVC_827F7579BEA1", {"date": "2026-03-09"})。
调用成功，拿回名言，整个过程无需人类插手！
📦 给买家提供的极简 SDK 长什么样？（直接抄进代码库）
咱们要在开源的 GitHub 仓库里，放一个类似于 synapse_client.py 的文件，买家的开发者只需要 pip install synapse-client。

它的核心代码极其精简，就两个动作：找服务 和 花钱调服务。

Python
import requests

class SynapseBuyer:
    def __init__(self, credential_token: str, gateway_url="http://127.0.0.1:8000"):
        """
        初始化买家客户端
        :param credential_token: 买家在咱们控制台生成的 X-Agent-Credential
        """
        self.credential = credential_token
        self.gateway_url = gateway_url

    def discover_services(self, intent: str) -> dict:
        """
        动作 1：AI 逛超市（免费）
        """
        url = f"{self.gateway_url}/api/v2/services/discover?intent={intent}"
        response = requests.get(url)
        return response.json()

    def invoke_service(self, service_id: str, payload: dict) -> dict:
        """
        动作 2：AI 掏钱调用（网关扣费）
        """
        # 注意：这里不直接请求卖家，而是请求咱们的【扣费网关】
        url = f"{self.gateway_url}/api/v2/gateway/forward/{service_id}"
        
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Credential": self.credential  # 带上钱袋子！
        }
        
        response = requests.post(url, headers=headers, json=payload)
        return response.json()
🤖 买家的开发者（AI 程序员）怎么用？
对于买家的开发者来说，他们简直爽翻了！如果他用的是目前最火的 LangChain 框架，他只需要把你的 SDK 包装成 AI 的“工具（Tools）”：

Python
# 这是买家开发者的代码（他不需要懂区块链，不需要懂支付）
from synapse_client import SynapseBuyer

# 1. 填入在 Synapse Network 充过值的凭据
synapse = SynapseBuyer(credential_token="74514021-68a8-4e33-9a1e-c465a74dab19")

# 2. 扔给 AI 去自主决策
intent = "我需要一句关于坚持的名人名言"

# 第一步：AI 自动搜索服务
discovered = synapse.discover_services(intent)
target_service_id = discovered['services'][0]['serviceId']  # AI 找到了 SVC_827F...

# 第二步：AI 自动组装参数并掏钱购买！
ai_generated_payload = {"date": "today"}
result = synapse.invoke_service(target_service_id, ai_generated_payload)

print(result) 
# 输出："天行健，君子以自强不息。" 
# 此时，网关已经悄无声息地扣掉了他 0.05 USDC！
👑 咱们的商业闭环，正式大满贯！
兄弟，这套 SDK 就是你插进全世界 AI 开发者心脏的管子！

你想想，以前一个 AI 开发者想让他的 Agent 获取各种外部数据，他得去几十个不同的网站注册账号、绑几十次信用卡、看几十份乱七八糟的 API 文档。

现在呢？ 只要引入你的 SynapseBuyer SDK，只要给那个 credential_token 里充过 USDC，他的 AI 就瞬间拥有了全网漫游、无限购买的能力！

而你，稳坐钓鱼台，看着网关里的日志一行行刷过，每一行都是“扣费 0.05”、“抽水 0.0005”的声音。

行动指令： 你现在已经写出了极其完美的 discover 接口和返回结构！ 下一步，你只需要在你的 python_sdk 目录里，把上面那个 SynapseBuyer 类写出来。然后咱们就去写最关键的那个东西——网关拦截扣费接口（/api/v2/gateway/forward/{service_id}）！

---

## 当前代码库落地实现（已对齐）

为了让买家开发者可直接接入，SDK 已落地在 `python_sdk/buyer_sdk/`：

```text
python_sdk/
    buyer_sdk/
        __init__.py
        client.py
        models.py
        exceptions.py
    examples/
        buyer_sdk_discover_invoke.py
```

### 为什么放在 `python_sdk/` 最合适

1. `provider_service/` 是服务端部署代码，不适合作为买家侧依赖分发。
2. `python_sdk/` 已经是外部 Python 使用入口（含示例与说明），语义最清晰。
3. 后续若发布 pip 包（如 `synapse-client`），可直接从该目录抽取。

### SDK 对外接口（Buyer）

- `discover_services(intent)`
    - 对应：`GET /api/v2/services/discover`
- `invoke_service(service_id, payload, tx_hash)`
    - 当前对接：`POST /api/v2/generate`
    - Header：`X-Service-Id` + `X-Agent-Credential`
    - 内置 202 Pending 轮询处理

> 说明：当前实现以 `/api/v2/generate` 为主路径；`tx_hash` 参数在 SDK 中为可选兼容字段，不是必需输入。

### 快速示例

```python
from buyer_sdk import SynapseBuyer

client = SynapseBuyer(
        credential_token="<X-Agent-Credential>",
        gateway_url="http://127.0.0.1:8000",
)

discovery = client.discover_services(intent="名人名言")
service_id = discovery["services"][0]["serviceId"]

result = client.invoke_service(
        service_id=service_id,
        payload={"prompt": "请给我一句关于坚持的名人名言"},
        tx_hash="0x...",
)
```