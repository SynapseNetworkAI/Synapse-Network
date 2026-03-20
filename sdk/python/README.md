# Synapse Client

Official Python SDK for Synapse agent-first runtime APIs.

`synapse-client` is designed around the Synapse runtime contract:

1. `discovery/search`
2. `quotes`
3. `invocations`
4. `invocation receipt`

That means an agent can discover a service, preflight budget and constraints, invoke with idempotency, and poll receipt state without inventing its own transport layer.

## Installation

```bash
pip install synapse-client
```

If you are developing locally, create a dedicated SDK virtual environment from `sdk/python` and install there:

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
```

## Usage

### Live smoke test

For local gateway validation, use the executable example instead of running package modules directly:

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --query "名人名言"
```

`examples/smoke_test.py` drives the real runtime path:

1. `POST /api/v1/agent/discovery/search`
2. `POST /api/v1/agent/quotes`
3. `POST /api/v1/agent/invocations`
4. `GET /api/v1/agent/invocations/{invocationId}` when polling is needed

By default, the script now auto-generates a fresh `request_id` and `idempotency_key` for each run so repeated smoke tests create a real new invocation instead of replaying an older one.

If you already know the service id, skip discovery:

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py --service-id svc_quotes_famous_top3
```

If you want to send a structured request body instead of the default `{\"text\": ...}` payload:

```bash
cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py \
    --service-id svc_quotes_famous_top3 \
    --payload-json '{"topic":"perseverance","style":"short"}'
```

### End-to-end local validation

Use this when you want to confirm the full SDK -> gateway -> provider chain rather than only validating package import or unit tests.

1. Start or restart the local gateway.
2. Ensure there is at least one discoverable healthy service behind the gateway.
3. Export a real agent credential into `SYNAPSE_API_KEY`.
4. Run the smoke test from `sdk/python`.
5. Confirm the script prints `Invocation succeeded` and returns a non-empty `invocationId` in the final JSON.

Example:

```bash
sh /Users/cliff/workspace/Synapse-Network/scripts/local/restart_gateway.sh

cd /Users/cliff/workspace/Synapse-Network/sdk/python
export SYNAPSE_API_KEY="agt_xxxxx..."
export SYNAPSE_GATEWAY="http://127.0.0.1:8000"
PYTHONPATH="$PWD" .venv/bin/python examples/smoke_test.py \
    --query "名人名言" \
    --text "想要放弃的时候，请给我一句关于坚持的名人名言"
```

The script prints the resolved gateway, generated `request_id`, generated `idempotency_key`, discovery results, selected service, and the raw invocation response. Keep the printed identifiers if you need to correlate the run with gateway logs.

### Recommended: discover -> quote -> invoke

Use the structured runtime flow when your agent needs to choose a service autonomously.

```python
from synapse_client import SynapseClient

client = SynapseClient(api_key="agt_xxxxx...")

discovery = client.discover_services(
    intent="cheap OCR for SEA invoices",
    tags=["ocr", "invoice"],
)

if not discovery.results:
    raise RuntimeError("No discoverable service matched the request")

service = discovery.results[0]
quote = client.create_quote(
    service_id=service.service_id,
    input_preview={
        "sample": {
            "body": {
                "image_url": "https://example.com/invoice.png"
            }
        }
    },
)

invocation = client.create_invocation(
    quote_id=quote.quote_id,
    idempotency_key="task-8891-step-2",
    payload={
        "image_url": "https://example.com/invoice.png"
    },
)

if not invocation.is_terminal:
    invocation = client.wait_for_invocation(invocation.invocation_id, max_wait_sec=30)

print(invocation.status)
print(invocation.result)
print(invocation.charged_usdc)
```

### Shortcut: one-call helper

If you already know the `service_id`, use the helper that internally performs quote then invoke.

```python
from synapse_client import SynapseClient

client = SynapseClient(api_key="agt_xxxxx...")

response = client.call_service(
    service_id="svc_quotes_famous_top3",
    payload={"text": "给我一句关于坚持的名人名言"},
    idempotency_key="job-42-step-1",
)

print(response.content)
print(response.fee_deducted)
print(response.invocation_id)
```

### Agent integration guidance

For production agent integration, the recommended stack is:

1. `SDK` as the executable control plane for discovery, quote, invoke, and receipt polling.
2. `Agent-readable markdown` as the stable contract and orchestration guide.
3. `CLI` only as an operator debugging tool or demo harness.
4. `Skills` only when you are integrating with an IDE agent environment such as Copilot customizations, not as the runtime transport for your autonomous agent.

Why:

1. Skills solve prompt-time workflow composition inside an IDE or chat agent.
2. Your runtime agent still needs a deterministic programmatic client with idempotency and error handling.
3. A markdown contract helps external agents understand when to discover, when to quote, what fields matter, and how to react to stable error codes.

See the design note in `docs/agent/07_Agent_SDK_Integration_Guide.md` for the recommended product shape.

### OpenAI-compatible proxy

If you already have an OpenAI-style agent and only want a compatibility path, you can still point it at Synapse's proxy surface.

```python
from openai import OpenAI

client = OpenAI(
    api_key="agt_xxxxx...", 
    base_url="http://127.0.0.1:8000/v1" # Target the Synapse Gateway
)

response = client.chat.completions.create(
    model="DeepSeek-R1-2501",
    messages=[{"role": "user", "content": "Hello, decentralized AI!"}]
)
```

---

## Environment Variables

You can inject configuration via environment variables without hardcoding them:

- `SYNAPSE_API_KEY`: Set your agent auth key.
- `SYNAPSE_GATEWAY`: Used by `examples/smoke_test.py` as the default gateway URL.

## Exceptions & Error Handling

- `DiscoveryError`: Discovery contract failed.
- `QuoteError`: Quote creation failed.
- `BudgetExceededError`: Credential budget, daily cap, or policy guard blocked the call.
- `InsufficientFundsError`: Remaining budget or credit is exhausted.
- `AuthenticationError`: When API key is disabled or revoked.
- `InvokeError`: Execution failed or receipt polling timed out.
