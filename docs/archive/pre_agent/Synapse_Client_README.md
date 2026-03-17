# Synapse Client
The official Python client for interacting with the Synapse Network AI services.
`synapse-client` lets you programmatically call decentralized AI tasks through Synapse Agent network with automatic billing and seamless API integrations.

## Installation

```bash
pip install synapse-client
```

*(If you are developing locally, install via `pip install -e .` from within the root directory)*

## Usage

### Mode 1: Hardcoded Service ID (Direct Invoke)
Call a specific service when you know its `Service ID`:
```python
from synapse_client import SynapseClient
import os

client = SynapseClient(api_key="agt_xxxxx...") # You can find your API key dynamically

response = client.call_service(
    service_id="SVC_WEATHER_001",
    payload={
        "location": "Kuala Lumpur",
        "days": 3
    }
)

print(response.content)
print(f"Cost Deducted: {response.fee_deducted} USDC")
print(f"Transaction Hash: {response.tx_hash}")
```

### Mode 2: Semantic Discovery
Find the best model dynamically based on your intent:
```python
client = SynapseClient(api_key="agt_xxxxx...")

discovery = client.discover_services(intent="image-generation", max_price=0.2)
if discovery.services:
    best_service = discovery.services[0].serviceId
    print(f"Available: {best_service}")
    
    res = client.call_service(
        service_id=best_service,
        payload={"prompt": "A futuristic cyberpunk city"}
    )
```

### Mode 3: OpenAI Drop-in (Universal API Proxy)
If you already have an Agent using OpenAI's library, you can instantly integrate with Synapse by simply changing the base URL.
```python
from openai import OpenAI

client = OpenAI(
    api_key="agt_xxxxx...", 
    base_url="http://127.0.0.1:8000/v1" # Target the Synapse Gateway
)

response = client.chat.completions.create(
    model="DeepSeek-R1-2501", # Equivalent to Synapse Service ID
    messages=[{"role": "user", "content": "Hello, decentralized AI!"}]
)
```

### Agent Tool/Function Conversion (OpenAI Schema)

`SynapseClient` has built-in features to export services as JSON schemas directly integrable into LangChain or OpenAI format agents:

```python
tools = client.get_tools()
print(tools) 
# Outputs: [{"type": "function", "function": {"name": "client.call_service_deepseek...", ...}}]
```

---

## Environment Variables

You can inject configuration via environment variables without hardcoding them:

- `SYNAPSE_API_KEY`: Set your agent auth key.
- `SYNAPSE_GATEWAY`: Override the gateway endpoint URL.

## Exceptions & Error Handling

- `InsufficientFundsError`: Catch this to notify user that their on-chain Vault USDC balance is out.
- `AuthenticationError`: When API key is disabled or revoked.
- `InvokeError`: Execution failed on the provider side.
