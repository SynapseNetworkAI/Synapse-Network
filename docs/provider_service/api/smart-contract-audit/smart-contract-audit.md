# 智能合约漏洞深度审计模型 API 设计

- Status: supplementary
- Runtime endpoint: `POST /provider-services/smart-contract-audit/invoke`

当前 `provider_service` 已经落地 V1 可调用实现：

1. `source_bundle` 模式可直接使用
2. `contract_address + chain` 模式当前按 `Sourcify -> Blockscout -> Etherscan` 顺序拉取 verified source
3. 返回骨架已经与其他 Provider runtime 服务保持一致：`service`、`sources`、`freshness`、`result`、`errors`

## 1. 服务定位

- `service_id`: `svc_smart_contract_audit`
- `service_name`: `Smart Contract Audit Model`
- `service_slug`: `smart-contract-audit-model`
- 目标：分析 Solidity 合约地址或源码包，输出结构化漏洞摘要、风险评分与修复建议

## 2. Manifest 草案

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

## 3. Input Schema 草案

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

## 4. Output Schema 草案

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

## 5. Demo Response 草案

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

## 6. Provider 侧实现逻辑

1. 校验是 `contract_address + chain` 还是 `source_bundle`
2. 如果是链上地址，先通过 `Sourcify` 获取已验证源码，失败后回退 `Blockscout / Etherscan`
3. 调用开源静态分析工具或规则引擎做扫描
4. 归并扫描结果为 `critical_findings`
5. 计算 `risk_score` 和 `risk_level`
6. 生成 `attack_surface_summary` 与 `fix_suggestions`
7. 写入审计结果快照表
8. 写入接口调用日志并返回结果

## 7. 最小实现建议

1. V1 不做超重型全链路审计编排
2. 先做静态分析 + `Sourcify` 已验证源码拉取
3. 这是 5 个里最重的服务，放最后落地是对的

## 9. 当前 V1 调用示例

如本地关闭 Gateway 验签：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/smart-contract-audit/invoke" \
  -H "Content-Type: application/json" \
  -d '{
    "source_bundle": "pragma solidity ^0.8.20; contract RiskyVault { function exec(address target, bytes calldata data) external { (bool ok, ) = target.delegatecall(data); require(ok); } }",
    "analysis_depth": "standard",
    "include_evidence": true
  }'
```

如保持 Gateway 验签开启，则需额外带上：

1. `X-Synapse-Service-Id: svc_smart_contract_audit`
2. `X-Synapse-Signed-At`
3. `X-Synapse-Signature`

## 8. 数据落地建议

- 必需表：`provider_api_invocations`
- 可选快照表：`provider_contract_audit_reports`
