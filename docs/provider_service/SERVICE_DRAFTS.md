# Provider Service 首批 5 个服务契约草案

## 1. 目标

这份文档解决的是冷启动阶段最容易卡死的一步：

**服务名字定了，但真正挂到 Synapse 上时，Manifest 怎么写、输入输出怎么收敛、Demo 返回长什么样，团队其实没统一。**

所以这里不讲战略，只讲契约草案。

每个服务都给出三层内容：

1. `manifest` 草案
2. `input_schema / output_schema` 草案
3. `demo response` 草案

对应拆分后的单服务接口文档见：

1. [Web3 实时情绪指数](./api/web3_sentiment_api/web3-sentiment-index.md)
2. [协议基本面情报包](./api/protocol-fundamental-brief.md)
3. [链上巨鲸资金异动监控](./api/whale-flow-monitor.md)
4. [开源仓库与依赖安全体检](./api/oss-security-healthcheck.md)
5. [智能合约漏洞深度审计模型](./api/smart-contract-audit.md)

如果要把这些 Manifest 草案继续落成 Provider Console 表单字段，请继续看：[Provider Console 字段映射与简化数据库设计](./PROVIDER_CONSOLE_FIELD_MAPPING.md)

默认假设：

1. V1 统一采用 `fixed` 按次计费
2. V1 优先同步调用
3. 对外暴露的是 Agent 可消费的结构化结果，不是原始上游返回
4. 公开契约不暴露 Provider 结算字段

## 2. 通用约束

### 2.1 命名约束

首批 5 个服务统一采用：

1. `service_id` 语义稳定，可用于长期引用
2. `service_name` 面向展示，尽量直白
3. `service_slug` 面向 URL 和搜索

### 2.2 公共返回骨架

建议 5 个服务统一输出以下顶层结构：

```json
{
  "service": {
    "serviceId": "svc_web3_sentiment_index",
    "serviceName": "Web3 Sentiment Index",
    "version": "1.0.0"
  },
  "sources": [
    {
      "name": "coingecko",
      "freshnessSec": 42
    }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:00:00Z",
    "maxSourceAgeSec": 42,
    "cacheHit": true
  },
  "result": {},
  "errors": []
}
```

### 2.3 V1 统一运行假设

1. `auth_mode` 统一为平台网关签发的服务调用凭据
2. `quote_required` 默认 `false`
3. `streaming_supported` 默认 `false`
4. `callback_supported` 默认 `false`
5. `settlement_currency` 统一 `USDC`

---

## 3. 服务 1: Web3 实时情绪指数

### 3.1 Manifest 草案

```json
{
  "service_id": "svc_web3_sentiment_index",
  "service_name": "Web3 Sentiment Index",
  "service_slug": "web3-sentiment-index",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Return a structured crypto market sentiment score with trend direction, volatility signal, and concise reasoning for a token or market segment.",
  "task_category": "web3.market.sentiment",
  "capabilities": [
    "market_sentiment_scoring",
    "trend_summary",
    "volatility_signal",
    "multi_source_reasoning"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.01",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/web3-sentiment-index/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 8000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 131072,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["market-data", "public-data", "no-pii"]
}
```

### 3.2 Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["symbol"],
  "properties": {
    "symbol": {
      "type": "string",
      "description": "Token symbol or market symbol, such as BTC, ETH, SOL.",
      "minLength": 2,
      "maxLength": 20
    },
    "chain": {
      "type": "string",
      "description": "Optional chain scope, such as ethereum, solana, base.",
      "default": "market-wide"
    },
    "lookback_hours": {
      "type": "integer",
      "minimum": 1,
      "maximum": 168,
      "default": 24
    },
    "include_narrative": {
      "type": "boolean",
      "default": true
    }
  }
}
```

### 3.3 Output Schema 草案

```json
{
  "type": "object",
  "required": ["service", "freshness", "result", "errors"],
  "properties": {
    "service": { "type": "object" },
    "sources": { "type": "array" },
    "freshness": { "type": "object" },
    "errors": { "type": "array" },
    "result": {
      "type": "object",
      "required": ["symbol", "sentiment_score", "sentiment_label", "trend_direction", "volatility_signal", "reasoning_bullets"],
      "properties": {
        "symbol": { "type": "string" },
        "sentiment_score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "sentiment_label": { "type": "string", "enum": ["extreme_fear", "fear", "neutral", "greed", "extreme_greed"] },
        "trend_direction": { "type": "string", "enum": ["up", "down", "sideways"] },
        "volatility_signal": { "type": "string", "enum": ["low", "medium", "high"] },
        "market_temperature": { "type": "string" },
        "reasoning_bullets": {
          "type": "array",
          "items": { "type": "string" },
          "minItems": 2,
          "maxItems": 5
        },
        "action_hint": { "type": "string" }
      }
    }
  }
}
```

### 3.4 Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_web3_sentiment_index",
    "serviceName": "Web3 Sentiment Index",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "alternative_me", "freshnessSec": 1800 },
    { "name": "coingecko", "freshnessSec": 45 },
    { "name": "binance_market_data", "freshnessSec": 8 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:00:00Z",
    "maxSourceAgeSec": 1800,
    "cacheHit": true
  },
  "result": {
    "symbol": "ETH",
    "sentiment_score": 68,
    "sentiment_label": "greed",
    "trend_direction": "up",
    "volatility_signal": "medium",
    "market_temperature": "risk-on but not overheated",
    "reasoning_bullets": [
      "Fear and Greed baseline is above neutral.",
      "Short-term price momentum remains positive.",
      "Intraday volatility is elevated but still below panic range."
    ],
    "action_hint": "Suitable for momentum-following agents, but keep tighter risk controls than in a low-volatility regime."
  },
  "errors": []
}
```

---

## 4. 服务 2: 智能合约漏洞深度审计模型

### 4.1 Manifest 草案

```json
{
  "service_id": "svc_smart_contract_audit",
  "service_name": "Smart Contract Audit Model",
  "service_slug": "smart-contract-audit-model",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Analyze a Solidity contract address or source bundle and return a structured vulnerability summary, risk score, key findings, and prioritized fix suggestions.",
  "task_category": "security.smart-contract.audit",
  "capabilities": [
    "solidity_static_analysis",
    "verified_source_fetch",
    "risk_scoring",
    "fix_recommendations"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.50",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/smart-contract-audit/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 30000,
  "streaming_supported": false,
  "async_supported": true,
  "callback_supported": false,
  "max_payload_bytes": 5242880,
  "availability_slo": 0.97,
  "region": ["global"],
  "compliance_tags": ["security", "code-analysis", "no-pii"]
}
```

### 4.2 Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "contract_address": {
      "type": "string",
      "description": "Verified contract address on a supported EVM chain."
    },
    "chain": {
      "type": "string",
      "description": "EVM chain name when contract_address is provided."
    },
    "source_bundle": {
      "type": "string",
      "description": "Optional inline source bundle or archive reference for local analysis."
    },
    "analysis_depth": {
      "type": "string",
      "enum": ["fast", "standard"],
      "default": "standard"
    },
    "include_evidence": {
      "type": "boolean",
      "default": true
    }
  },
  "oneOf": [
    { "required": ["contract_address", "chain"] },
    { "required": ["source_bundle"] }
  ]
}
```

### 4.3 Output Schema 草案

```json
{
  "type": "object",
  "required": ["service", "freshness", "result", "errors"],
  "properties": {
    "service": { "type": "object" },
    "sources": { "type": "array" },
    "freshness": { "type": "object" },
    "errors": { "type": "array" },
    "result": {
      "type": "object",
      "required": ["risk_score", "risk_level", "critical_findings", "attack_surface_summary", "fix_suggestions"],
      "properties": {
        "target": { "type": "string" },
        "risk_score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "risk_level": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
        "critical_findings": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["title", "severity", "description"],
            "properties": {
              "title": { "type": "string" },
              "severity": { "type": "string" },
              "description": { "type": "string" },
              "evidence": { "type": "string" }
            }
          }
        },
        "attack_surface_summary": { "type": "string" },
        "fix_suggestions": {
          "type": "array",
          "items": { "type": "string" }
        },
        "analysis_mode": { "type": "string" }
      }
    }
  }
}
```

### 4.4 Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_smart_contract_audit",
    "serviceName": "Smart Contract Audit Model",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "etherscan_verified_source", "freshnessSec": 120 },
    { "name": "slither", "freshnessSec": 0 },
    { "name": "mythril", "freshnessSec": 0 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:10:00Z",
    "maxSourceAgeSec": 120,
    "cacheHit": false
  },
  "result": {
    "target": "ethereum:0x1234...abcd",
    "risk_score": 81,
    "risk_level": "high",
    "critical_findings": [
      {
        "title": "Unchecked external call path",
        "severity": "high",
        "description": "A privileged execution path relies on an external call result without a strict post-condition check.",
        "evidence": "executeOperation() -> external target.call(...)"
      },
      {
        "title": "Upgrade authority concentration",
        "severity": "medium",
        "description": "Single-role upgrade control increases governance capture risk."
      }
    ],
    "attack_surface_summary": "Main risk centers on privileged execution and upgrade authority. No direct critical reentrancy path was confirmed in fast mode.",
    "fix_suggestions": [
      "Add explicit return-value checks and state invariants after external calls.",
      "Move upgrade control behind multisig or timelock.",
      "Add invariant tests for privileged execution paths."
    ],
    "analysis_mode": "standard"
  },
  "errors": []
}
```

---

## 5. 服务 3: 链上巨鲸资金异动监控

### 5.1 Manifest 草案

```json
{
  "service_id": "svc_whale_flow_monitor",
  "service_name": "Whale Flow Monitor",
  "service_slug": "whale-flow-monitor",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Monitor large on-chain token movements and return structured whale events, wallet tags, net direction, and estimated market impact.",
  "task_category": "web3.onchain.flow-monitoring",
  "capabilities": [
    "large_transfer_detection",
    "wallet_tagging",
    "net_direction_summary",
    "market_impact_guess"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.10",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/whale-flow-monitor/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 12000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 262144,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["onchain-data", "monitoring", "no-pii"]
}
```

### 5.2 Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["token", "chain"],
  "properties": {
    "token": {
      "type": "string",
      "description": "Token symbol or contract address."
    },
    "chain": {
      "type": "string",
      "description": "Chain scope, such as ethereum, base, arbitrum."
    },
    "window_minutes": {
      "type": "integer",
      "minimum": 5,
      "maximum": 1440,
      "default": 60
    },
    "min_usd_value": {
      "type": "number",
      "minimum": 10000,
      "default": 100000
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 50,
      "default": 10
    }
  }
}
```

### 5.3 Output Schema 草案

```json
{
  "type": "object",
  "required": ["service", "freshness", "result", "errors"],
  "properties": {
    "service": { "type": "object" },
    "sources": { "type": "array" },
    "freshness": { "type": "object" },
    "errors": { "type": "array" },
    "result": {
      "type": "object",
      "required": ["token", "chain", "net_direction", "market_impact_guess", "events"],
      "properties": {
        "token": { "type": "string" },
        "chain": { "type": "string" },
        "net_direction": { "type": "string", "enum": ["net_inflow", "net_outflow", "mixed"] },
        "market_impact_guess": { "type": "string" },
        "watchlist_matches": {
          "type": "array",
          "items": { "type": "string" }
        },
        "events": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["timestamp", "usd_value", "direction", "summary"],
            "properties": {
              "timestamp": { "type": "string" },
              "usd_value": { "type": "number" },
              "direction": { "type": "string" },
              "wallet_tags": {
                "type": "array",
                "items": { "type": "string" }
              },
              "summary": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

### 5.4 Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_whale_flow_monitor",
    "serviceName": "Whale Flow Monitor",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "blockscout", "freshnessSec": 20 },
    { "name": "dexscreener", "freshnessSec": 15 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:20:00Z",
    "maxSourceAgeSec": 20,
    "cacheHit": false
  },
  "result": {
    "token": "ETH",
    "chain": "ethereum",
    "net_direction": "net_outflow",
    "market_impact_guess": "Whale transfers suggest potential exchange-side sell pressure in the current window.",
    "watchlist_matches": ["known_exchange", "smart_money_watchlist"],
    "events": [
      {
        "timestamp": "2026-03-23T12:12:14Z",
        "usd_value": 2450000,
        "direction": "wallet_to_exchange",
        "wallet_tags": ["whale_wallet", "known_exchange"],
        "summary": "A whale-sized ETH transfer moved into a tagged exchange wallet."
      },
      {
        "timestamp": "2026-03-23T11:58:02Z",
        "usd_value": 1380000,
        "direction": "wallet_to_wallet",
        "wallet_tags": ["smart_money_watchlist"],
        "summary": "A tracked smart-money wallet reallocated ETH across self-custody addresses."
      }
    ]
  },
  "errors": []
}
```

---

## 6. 服务 4: 协议基本面情报包

### 6.1 Manifest 草案

```json
{
  "service_id": "svc_protocol_fundamental_brief",
  "service_name": "Protocol Fundamental Brief",
  "service_slug": "protocol-fundamental-brief",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Return a structured protocol intelligence brief covering price context, TVL trend, revenue signals, peer comparison, and key risk flags.",
  "task_category": "web3.research.fundamental-brief",
  "capabilities": [
    "protocol_snapshot",
    "tvl_summary",
    "revenue_signal_summary",
    "peer_comparison",
    "risk_flagging"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.03",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/protocol-fundamental-brief/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 10000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 131072,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["research", "market-data", "no-pii"]
}
```

### 6.2 Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["protocol"],
  "properties": {
    "protocol": {
      "type": "string",
      "description": "Protocol name, slug, or token ticker for lookup."
    },
    "chain": {
      "type": "string",
      "description": "Optional chain filter for multi-chain protocols."
    },
    "peer_set": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 5
    },
    "lookback_days": {
      "type": "integer",
      "minimum": 1,
      "maximum": 90,
      "default": 30
    }
  }
}
```

### 6.3 Output Schema 草案

```json
{
  "type": "object",
  "required": ["service", "freshness", "result", "errors"],
  "properties": {
    "service": { "type": "object" },
    "sources": { "type": "array" },
    "freshness": { "type": "object" },
    "errors": { "type": "array" },
    "result": {
      "type": "object",
      "required": ["protocol", "price_summary", "tvl_summary", "revenue_signals", "peer_comparison", "risk_flags"],
      "properties": {
        "protocol": { "type": "string" },
        "price_summary": { "type": "string" },
        "tvl_summary": { "type": "string" },
        "revenue_signals": {
          "type": "array",
          "items": { "type": "string" }
        },
        "peer_comparison": {
          "type": "array",
          "items": { "type": "string" }
        },
        "risk_flags": {
          "type": "array",
          "items": { "type": "string" }
        },
        "operator_view": { "type": "string" }
      }
    }
  }
}
```

### 6.4 Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_protocol_fundamental_brief",
    "serviceName": "Protocol Fundamental Brief",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "coingecko", "freshnessSec": 60 },
    { "name": "defillama", "freshnessSec": 90 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:25:00Z",
    "maxSourceAgeSec": 90,
    "cacheHit": true
  },
  "result": {
    "protocol": "Aave",
    "price_summary": "Token price remains above the 30-day midpoint, but upside has slowed over the last 72 hours.",
    "tvl_summary": "TVL is stable to slightly positive over the 30-day window with no major cross-chain contraction.",
    "revenue_signals": [
      "Usage-linked fee activity remains consistent.",
      "There is no obvious revenue collapse signal in the latest window."
    ],
    "peer_comparison": [
      "TVL trend is stronger than the median of selected lending peers.",
      "Revenue momentum appears steadier than smaller emerging competitors."
    ],
    "risk_flags": [
      "Governance-driven parameter changes can rapidly alter collateral behavior.",
      "Macro liquidity shifts may compress lending demand."
    ],
    "operator_view": "Useful as a fast screening brief before deeper protocol due diligence."
  },
  "errors": []
}
```

---

## 7. 服务 5: 开源仓库与依赖安全体检

### 7.1 Manifest 草案

```json
{
  "service_id": "svc_oss_security_healthcheck",
  "service_name": "OSS Security Healthcheck",
  "service_slug": "oss-security-healthcheck",
  "manifest_version": "1.0.0",
  "status": "draft",
  "description_for_model": "Analyze a GitHub repository or dependency list and return a structured summary covering vulnerabilities, maintainer activity, dependency risk, and upgrade advice.",
  "task_category": "security.oss.healthcheck",
  "capabilities": [
    "repo_activity_analysis",
    "dependency_vulnerability_lookup",
    "maintainer_signal_summary",
    "upgrade_advice"
  ],
  "price_model": "fixed",
  "base_price_usdc": "0.05",
  "settlement_currency": "USDC",
  "quote_required": false,
  "endpoint_url": "https://platform.synapse.local/provider-services/oss-security-healthcheck/invoke",
  "auth_mode": "gateway_signed",
  "timeout_ms": 15000,
  "streaming_supported": false,
  "async_supported": false,
  "callback_supported": false,
  "max_payload_bytes": 262144,
  "availability_slo": 0.99,
  "region": ["global"],
  "compliance_tags": ["oss-security", "repo-analysis", "no-pii"]
}
```

### 7.2 Input Schema 草案

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo_url": {
      "type": "string",
      "description": "GitHub repository URL."
    },
    "ecosystem": {
      "type": "string",
      "enum": ["npm", "pypi", "mixed"]
    },
    "package_list": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "version"],
        "properties": {
          "name": { "type": "string" },
          "version": { "type": "string" }
        }
      },
      "maxItems": 200
    },
    "include_upgrade_advice": {
      "type": "boolean",
      "default": true
    }
  },
  "anyOf": [
    { "required": ["repo_url"] },
    { "required": ["package_list", "ecosystem"] }
  ]
}
```

### 7.3 Output Schema 草案

```json
{
  "type": "object",
  "required": ["service", "freshness", "result", "errors"],
  "properties": {
    "service": { "type": "object" },
    "sources": { "type": "array" },
    "freshness": { "type": "object" },
    "errors": { "type": "array" },
    "result": {
      "type": "object",
      "required": ["repo_health_score", "dependency_risk_summary", "maintainer_activity", "upgrade_advice", "vulnerability_matches"],
      "properties": {
        "repo_health_score": { "type": "integer", "minimum": 0, "maximum": 100 },
        "dependency_risk_summary": { "type": "string" },
        "maintainer_activity": { "type": "string" },
        "upgrade_advice": {
          "type": "array",
          "items": { "type": "string" }
        },
        "vulnerability_matches": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["package", "severity", "summary"],
            "properties": {
              "package": { "type": "string" },
              "severity": { "type": "string" },
              "summary": { "type": "string" },
              "fixed_in": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

### 7.4 Demo Response 草案

```json
{
  "service": {
    "serviceId": "svc_oss_security_healthcheck",
    "serviceName": "OSS Security Healthcheck",
    "version": "1.0.0"
  },
  "sources": [
    { "name": "github_rest_api", "freshnessSec": 120 },
    { "name": "osv_dev", "freshnessSec": 35 },
    { "name": "npm_registry", "freshnessSec": 60 }
  ],
  "freshness": {
    "generatedAt": "2026-03-23T12:30:00Z",
    "maxSourceAgeSec": 120,
    "cacheHit": false
  },
  "result": {
    "repo_health_score": 74,
    "dependency_risk_summary": "Dependency risk is manageable but not clean: one direct high-severity issue and several outdated transitive packages were detected.",
    "maintainer_activity": "Repository maintenance looks active enough for production consideration, with recent commits and issue activity in the last 30 days.",
    "upgrade_advice": [
      "Upgrade axios to a patched version.",
      "Review transitive dependency locks for outdated parser packages.",
      "Pin critical runtime dependencies to reviewed versions before release."
    ],
    "vulnerability_matches": [
      {
        "package": "axios",
        "severity": "high",
        "summary": "Known request handling vulnerability affects the pinned version.",
        "fixed_in": "1.6.8"
      }
    ]
  },
  "errors": []
}
```

---

## 8. 推荐落地顺序

如果现在要从文档进入实现，建议照这个顺序落地：

1. 先实现 `svc_web3_sentiment_index`
2. 再实现 `svc_protocol_fundamental_brief`
3. 再实现 `svc_whale_flow_monitor`
4. 然后做 `svc_oss_security_healthcheck`
5. 最后做 `svc_smart_contract_audit`

原因很简单：

1. 前三个更轻、更适合快速形成可演示货架
2. 第四个能把市场从纯 Web3 拉宽到开发者安全场景
3. 第五个最贵、最重、感知价值最高，但也最容易卡在实现复杂度上

## 9. 接口实现范围重新收口

按现在的边界，这 5 个服务的 Provider 侧实现只做两件事：

1. 提供标准 HTTP 接口给 Gateway 转发调用
2. 记录接口调用日志，便于排查成功率、耗时和上游异常

明确不做：

1. 不做服务注册能力，Gateway 已提供
2. 不做 Provider Console 工作流
3. 不做报价、结算、预算、钱包等能力
4. 不做复杂任务编排与异步发布系统

一句话：

**这 5 个服务现在只需要是“可被 Gateway 调用的 Provider API”，不是一整套 Provider 平台。**

## 10. 统一接口实现逻辑

5 个服务虽然领域不同，但 Provider 侧实现骨架应该完全一致。

### 10.1 统一请求处理链路

每个服务接口都按以下步骤执行：

1. 接收 Gateway 转发请求
2. 校验 `service_id`、鉴权头、请求参数和请求体大小
3. 生成 `request_id` 与内部 `invocation_id`
4. 查询本地缓存表或快照表，命中则直接返回
5. 未命中则请求上游免费 API / 开源工具
6. 将上游结果标准化为 Synapse 对外响应结构
7. 写入接口调用日志
8. 如有必要，刷新本地缓存或快照
9. 返回结构化结果给 Gateway

### 10.2 Provider 统一接口约定

建议 5 个服务统一采用：

1. `POST /invoke`
2. `GET /health`

接口行为约束：

1. `POST /invoke` 只接受 Gateway 调用，不对外开放匿名流量
2. `GET /health` 只返回服务是否存活、最近上游是否可访问、版本号
3. 所有服务都返回同一套顶层骨架：`service`、`sources`、`freshness`、`result`、`errors`

### 10.3 统一异常处理

每个服务都应该把错误收敛成三类：

1. 请求错误：参数非法、缺字段、超出限制，直接返回 `400`
2. 上游错误：免费 API 超时、限流、返回异常，返回 `502/504`
3. 内部错误：解析失败、存储失败、代码异常，返回 `500`

同时无论成功失败，都要落接口调用日志。

## 11. 5 个服务的接口实现逻辑

## 11.1 `svc_web3_sentiment_index`

### 实现目标

输入 `symbol` / `chain` / `lookback_hours`，输出市场情绪分、趋势方向、波动信号与简要解释。

### Provider 侧实现步骤

1. 校验 `symbol`、`chain`、`lookback_hours`
2. 读取本地情绪快照缓存，判断是否在可复用时间窗内
3. 若缓存失效，则并行拉取免费市场数据源，例如情绪指数、价格动量、波动率、成交量变化
4. 将不同来源映射到统一分值区间
5. 计算 `sentiment_score`、`sentiment_label`、`trend_direction`、`volatility_signal`
6. 拼接 `reasoning_bullets` 和 `action_hint`
7. 写入情绪快照表
8. 写入接口调用日志
9. 返回标准响应

### 最小实现建议

1. V1 不做复杂机器学习模型
2. 先做规则分数聚合器即可
3. 先支持 `BTC`、`ETH`、`SOL` 等高频 symbol

## 11.2 `svc_protocol_fundamental_brief`

### 实现目标

输入 `protocol` / `chain` / `peer_set` / `lookback_days`，输出协议基本面摘要。

### Provider 侧实现步骤

1. 校验协议名称与观察窗口
2. 查询本地协议快照缓存
3. 若缓存失效，则拉取价格、TVL、收入或活跃度等公开数据
4. 生成 `price_summary`、`tvl_summary`、`revenue_signals`
5. 如传入 `peer_set`，补充 `peer_comparison`
6. 结合数据波动和链上/治理特征生成 `risk_flags`
7. 输出 `operator_view` 作为快速研判结论
8. 写入协议快照表
9. 写入接口调用日志并返回结果

### 最小实现建议

1. V1 优先做 DefiLlama + CoinGecko 级别公开数据整合
2. 先不做长篇报告，只做结构化 brief
3. 每次调用返回 5 到 10 条高价值摘要，不要写成研报生成器

## 11.3 `svc_whale_flow_monitor`

### 实现目标

输入 `token` / `chain` / `window_minutes` / `min_usd_value`，输出巨鲸资金异动列表与净流向判断。

### Provider 侧实现步骤

1. 校验 token、chain、时间窗、最小金额阈值
2. 读取最近窗口内的本地事件缓存
3. 若缓存不足，则拉取链上转账数据和价格换算数据
4. 按 `min_usd_value` 过滤大额事件
5. 对地址做轻量标签归类，例如 `exchange`、`whale_wallet`、`smart_money_watchlist`
6. 汇总 `net_direction` 与 `market_impact_guess`
7. 生成 `events` 列表与 `watchlist_matches`
8. 写入事件快照表
9. 写入接口调用日志并返回结果

### 最小实现建议

1. V1 先支持 EVM 主链
2. 标签系统先走静态标签 + 简单规则
3. 不做实时流处理，先按调用窗口查询聚合

## 11.4 `svc_oss_security_healthcheck`

### 实现目标

输入仓库地址或依赖列表，输出开源仓库健康度、依赖风险与升级建议。

### Provider 侧实现步骤

1. 校验 `repo_url` 或 `package_list`
2. 对 GitHub 仓库模式，抓取最近提交、issue 活跃度、release 频率
3. 对依赖模式，查询公开漏洞数据库和包管理器元数据
4. 汇总出 `repo_health_score`、`dependency_risk_summary`、`maintainer_activity`
5. 生成 `upgrade_advice`
6. 结构化输出 `vulnerability_matches`
7. 写入安全检查快照表
8. 写入接口调用日志并返回结果

### 最小实现建议

1. V1 只支持 GitHub、npm、PyPI
2. 先做已知漏洞检索与维护活跃度聚合
3. 不做深度 SCA 平台能力替代

## 11.5 `svc_smart_contract_audit`

### 实现目标

输入链上地址或源码包，输出漏洞摘要、风险分和修复建议。

### Provider 侧实现步骤

1. 校验是 `contract_address + chain` 还是 `source_bundle`
2. 如果是链上地址，先获取已验证源码
3. 调用开源静态分析工具或规则引擎做扫描
4. 归并扫描结果为 `critical_findings`
5. 计算 `risk_score` 和 `risk_level`
6. 生成 `attack_surface_summary` 与 `fix_suggestions`
7. 写入审计结果快照表
8. 写入接口调用日志并返回结果

### 最小实现建议

1. V1 不做超重型全链路审计编排
2. 先做静态分析 + 已验证源码拉取
3. 这是 5 个里最重的服务，放最后落地是对的

## 12. Provider 侧最小数据库设计

## 12.1 设计原则

因为 Gateway 已经负责服务注册，Provider 侧数据库只需要承担两件事：

1. 记录接口调用
2. 存少量本地缓存 / 快照，降低上游免费接口压力

因此 Provider 侧数据库不需要再有：

1. 服务注册表
2. Provider 账户体系表
3. 发布流程表
4. 鉴权工作流表

## 12.2 必须有的一张公共表

无论 5 个服务怎么实现，都建议先建一张公共调用日志表。

```sql
CREATE TABLE IF NOT EXISTS provider_api_invocations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invocation_id TEXT NOT NULL UNIQUE,
  service_id TEXT NOT NULL,
  request_id TEXT,
  gateway_request_id TEXT,
  caller_type TEXT NOT NULL DEFAULT 'gateway',
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status INTEGER NOT NULL,
  error_code TEXT,
  upstream_status INTEGER,
  latency_ms INTEGER,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(input_payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_provider_api_invocations_service_created
ON provider_api_invocations (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_api_invocations_request_id
ON provider_api_invocations (request_id);
```

这张表的作用只有三个：

1. 看每个服务被调了多少次
2. 看耗时、缓存命中、上游状态码是否异常
3. 失败时可以按 `request_id` 或 `invocation_id` 反查

## 12.3 各服务可选缓存 / 快照表

如果你要极简到极致，只保留 `provider_api_invocations` 也能上线。

但从实现效率看，下面 5 张轻量缓存 / 快照表值得保留。

### 12.3.1 情绪快照表

```sql
CREATE TABLE IF NOT EXISTS provider_sentiment_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  chain TEXT NOT NULL,
  lookback_hours INTEGER NOT NULL,
  sentiment_score INTEGER NOT NULL,
  sentiment_label TEXT NOT NULL,
  trend_direction TEXT NOT NULL,
  volatility_signal TEXT NOT NULL,
  result_payload JSONB NOT NULL,
  source_generated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(result_payload) = 'object')
);
```

用途：缓存短周期情绪结果，避免同一 symbol 被高频重复计算。

### 12.3.2 协议基本面快照表

```sql
CREATE TABLE IF NOT EXISTS provider_protocol_briefs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brief_key TEXT NOT NULL UNIQUE,
  protocol TEXT NOT NULL,
  chain TEXT,
  lookback_days INTEGER NOT NULL,
  result_payload JSONB NOT NULL,
  source_generated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(result_payload) = 'object')
);
```

用途：缓存协议 brief，减少重复抓取公开数据源。

### 12.3.3 巨鲸事件快照表

```sql
CREATE TABLE IF NOT EXISTS provider_whale_flow_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_key TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  chain TEXT NOT NULL,
  window_minutes INTEGER NOT NULL,
  min_usd_value NUMERIC(24, 6) NOT NULL,
  result_payload JSONB NOT NULL,
  source_generated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(result_payload) = 'object')
);
```

用途：缓存窗口化巨鲸异动结果，避免每次都从链上重扫。

### 12.3.4 开源安全检查快照表

```sql
CREATE TABLE IF NOT EXISTS provider_oss_security_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_key TEXT NOT NULL UNIQUE,
  repo_url TEXT,
  ecosystem TEXT,
  package_fingerprint TEXT,
  result_payload JSONB NOT NULL,
  source_generated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(result_payload) = 'object')
);
```

用途：缓存仓库或依赖安全体检结果，降低 OSV / GitHub 查询频率。

### 12.3.5 合约审计结果快照表

```sql
CREATE TABLE IF NOT EXISTS provider_contract_audit_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_key TEXT NOT NULL UNIQUE,
  contract_address TEXT,
  chain TEXT,
  source_fingerprint TEXT,
  analysis_depth TEXT NOT NULL,
  result_payload JSONB NOT NULL,
  source_generated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(result_payload) = 'object')
);
```

用途：缓存合约审计结果，避免同一目标被重复静态扫描。

## 12.4 5 个服务与表的对应关系

| 服务 | 必需表 | 可选快照表 |
| --- | --- | --- |
| `svc_web3_sentiment_index` | `provider_api_invocations` | `provider_sentiment_snapshots` |
| `svc_protocol_fundamental_brief` | `provider_api_invocations` | `provider_protocol_briefs` |
| `svc_whale_flow_monitor` | `provider_api_invocations` | `provider_whale_flow_snapshots` |
| `svc_oss_security_healthcheck` | `provider_api_invocations` | `provider_oss_security_reports` |
| `svc_smart_contract_audit` | `provider_api_invocations` | `provider_contract_audit_reports` |

## 13. 直接落地建议

如果目标是最短时间把这 5 个 Provider API 跑起来，建议严格按下面节奏做：

1. 所有服务先共用一套 Provider API 框架、统一日志表 `provider_api_invocations`
2. 第一批只实现 `svc_web3_sentiment_index`、`svc_protocol_fundamental_brief`、`svc_whale_flow_monitor`
3. 所有服务先做同步 `POST /invoke`，不做异步任务系统
4. 每个服务先接 1 到 2 个免费上游，先跑通结果，不追求完美覆盖
5. 只有当上游压力和响应时间真的成为问题时，再启用对应快照表

一句话收口：

**按你现在的边界，Provider 侧最小可行实现就是“5 个标准化接口 + 1 张公共调用日志表 + 少量可选缓存表”，别再往控制面和注册系统上扩。**