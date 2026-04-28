# Gateway LLM Token-Metered Service Design

Status: staging-ready design, V1 billing safety gate

Last updated: 2026-04-28

## Summary

Synapse supports Provider-owned LLM services without becoming a model reseller.

Provider owns the model integration, API keys, prompt handling, and upstream model routing. Gateway owns:

1. Agent invocation admission.
2. Token-metered pre-authorization hold.
3. Final usage parsing.
4. Decimal-safe USDC charge calculation.
5. Consumer debit, Provider credit, Platform fee, audit, usage, and reconciliation evidence.

The V1 rule is intentionally strict:

```text
No final usage, no charge.
No streaming, no LLM invoke.
```

## Service Contract

An LLM service must declare:

```json
{
  "serviceKind": "llm",
  "priceModel": "token_metered",
  "metering": {
    "billingUnit": "token",
    "inputPricePer1MTokensUsdc": "0.140000",
    "outputPricePer1MTokensUsdc": "0.280000",
    "defaultMaxOutputTokens": 2048,
    "holdBufferMultiplier": "1.2",
    "maxAutoHoldUsdc": "1.000000"
  },
  "constraints": {
    "timeoutMs": 120000
  }
}
```

Do not use `pricePerToken`. Token prices are always expressed as USDC per one million tokens. This keeps tiny model prices representable without float drift.

## Timeout Profile

LLM and API services use different synchronous timeout profiles:

| Service profile | Default | Maximum |
| --- | ---: | ---: |
| API / fixed price | `15000ms` | `60000ms` |
| LLM / `token_metered` | `120000ms` | `300000ms` |

`timeoutMs=0` is not allowed. A model call that needs more than 5 minutes belongs in a future async invocation / callback flow, not a synchronous Gateway worker.

## Streaming Rule

V1 rejects streaming before upstream call:

```json
{
  "stream": true
}
```

returns:

```json
{
  "error": {
    "code": "LLM_STREAMING_NOT_SUPPORTED",
    "message": "Streaming LLM responses are not supported in Synapse V1 because final token usage is required for billing."
  }
}
```

Gateway also rejects upstream `text/event-stream` responses. We do not silently rewrite `stream=true` to `false`, because billing semantics must be explicit.

## Pre-Authorization Hold

Caller may pass an explicit ceiling:

```json
{
  "maxCostUsdc": "0.010000"
}
```

If omitted, Gateway computes an automatic hold:

```text
estimated_input_tokens = ceil(prompt_character_count / 3)
estimated_output_tokens = request.max_tokens || service.defaultMaxOutputTokens || 2048
estimated_cost =
  estimated_input_tokens * inputPricePer1MTokensUsdc / 1_000_000
  + estimated_output_tokens * outputPricePer1MTokensUsdc / 1_000_000
holdUsdc = ceil_to_6_decimals(estimated_cost * holdBufferMultiplier)
```

Default buffer is `1.2`. Gateway does not run `tiktoken`, `sentencepiece`, or provider-specific tokenizers in V1. The hold is a conservative estimate, not the final charge.

If auto hold exceeds `maxAutoHoldUsdc`, Gateway rejects before upstream call and requires the caller to pass explicit `maxCostUsdc`.

## Final Charge

Provider response must include final usage.

OpenAI-compatible usage:

```json
{
  "usage": {
    "prompt_tokens": 1200,
    "completion_tokens": 300,
    "total_tokens": 1500
  }
}
```

Synapse normalized usage:

```json
{
  "usage": {
    "input_tokens": 1200,
    "output_tokens": 300,
    "total_tokens": 1500
  }
}
```

Charge formula:

```text
input_charge = input_tokens * inputPricePer1MTokensUsdc / 1_000_000
output_charge = output_tokens * outputPricePer1MTokensUsdc / 1_000_000
chargedUsdc = ceil_to_6_decimals(input_charge + output_charge)
```

All money math uses Decimal / NUMERIC and 6-decimal USDC quantization. Float is forbidden in the money path.

## Settlement State Machine

```text
1. Validate serviceKind=llm or priceModel=token_metered
2. Reject stream=true
3. Estimate or accept maxCostUsdc
4. Freeze Consumer holdUsdc
5. Call Provider endpoint
6. Parse final usage
7. Compute chargedUsdc
8. Atomically:
   - release holdUsdc - chargedUsdc to Consumer available
   - capture chargedUsdc from Consumer hold
   - credit Provider revenue
   - accrue Platform fee
   - write usage/audit facts
9. Persist invocation result with billing metadata
```

Provider failure before final usage:

```text
release full hold
do not charge
record failed invocation
```

Provider success without usage:

```text
release full hold
do not charge
record LLM_USAGE_MISSING
mark provider health/billing quality for review
```

Actual charge greater than hold is a critical billing anomaly and must fail closed. Gateway must never create negative Consumer balance.

## Runtime Response

Successful LLM invocation response includes Synapse billing metadata in the result payload:

```json
{
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 300,
    "totalTokens": 1500
  },
  "synapse": {
    "priceModel": "token_metered",
    "holdUsdc": "0.001000",
    "chargedUsdc": "0.000253",
    "releasedUsdc": "0.000747",
    "providerRevenueUsdc": "0.000228",
    "platformFeeUsdc": "0.000025",
    "preAuthMode": "auto"
  }
}
```

## E2E Gate

DeepSeek Chat full-chain gate:

```bash
export LLM_E2E_GATEWAY_BASE=http://127.0.0.1:8000
export LLM_E2E_SERVICE_ID=svc_deepseek_chat
export LLM_E2E_CREDENTIAL=<local-test-agent-credential>
export LLM_E2E_INPUT_PRICE_PER_1M_USDC=0.140000
export LLM_E2E_OUTPUT_PRICE_PER_1M_USDC=0.280000

npm run e2e:llm-deepseek:local
npm run ci:llm-deepseek-local-evidence
```

Staging uses the same gate, but explicitly confirms it mutates staging balance and calls the live Provider:

```bash
export LLM_DEEPSEEK_E2E_CONFIRM=I_UNDERSTAND_THIS_CALLS_LIVE_LLM_AND_CHARGES_STAGING
export LLM_E2E_GATEWAY_BASE=https://api-staging.synapse-network.ai
export LLM_E2E_SERVICE_ID=svc_deepseek_chat
export LLM_E2E_CREDENTIAL=<staging-test-agent-credential>
export LLM_E2E_INPUT_PRICE_PER_1M_USDC=0.140000
export LLM_E2E_OUTPUT_PRICE_PER_1M_USDC=0.280000

npm run e2e:llm-deepseek:staging
npm run ci:llm-deepseek-staging-evidence
```

The checker verifies:

1. DeepSeek service is discoverable.
2. `/api/v1/agent/invoke` succeeds.
3. Final integer usage exists.
4. `chargedUsdc` exactly matches the per-1M-token formula.
5. `releasedUsdc = holdUsdc - chargedUsdc`.
6. `providerRevenueUsdc + platformFeeUsdc = chargedUsdc`.
7. Evidence contains no credential, API key, private key, or webhook secret.

