# 开源仓库与依赖安全体检 API 设计

## 1. 服务定位

- `service_id`: `svc_oss_security_healthcheck`
- `service_name`: `OSS Security Healthcheck`
- `service_slug`: `oss-security-healthcheck`
- 目标：分析 GitHub 仓库或依赖清单，输出漏洞、维护活跃度、依赖风险与升级建议

## 2. Manifest 草案

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

## 3. Input Schema 草案

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

## 5. Demo Response 草案

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

## 6. Provider 侧实现逻辑

1. 校验 `repo_url` 或 `package_list`
2. 对 GitHub 仓库模式，抓取最近提交、issue 活跃度、release 频率
3. 对依赖模式，查询公开漏洞数据库和包管理器元数据
4. 汇总出 `repo_health_score`、`dependency_risk_summary`、`maintainer_activity`
5. 生成 `upgrade_advice`
6. 结构化输出 `vulnerability_matches`
7. 写入安全检查快照表
8. 写入接口调用日志并返回结果

## 7. 最小实现建议

1. V1 只支持 GitHub、npm、PyPI
2. 先做已知漏洞检索与维护活跃度聚合
3. 不做深度 SCA 平台能力替代

## 8. 数据落地建议

- 必需表：`provider_api_invocations`
- 可选快照表：`provider_oss_security_reports`