# 智能合约漏洞深度审计模型实现设计文档

## 1. 设计目标

这份设计文档回答的是：如何在 `provider_service` 里落一个可 invoke、可测试、可持续扩展的合约审计服务，而不是只写一份看起来很猛的接口草案。

V1 目标：

1. 先把 `POST /provider-services/smart-contract-audit/invoke` 打通
2. 让返回结果保持结构化、稳定、可断言，不把核心判断塞进 prompt 黑盒
3. 给后续接入 `Slither + Mythril + report snapshot` 留出明确扩展点，同时先把 `Sourcify verified source fetch` 主链打通

## 2. 服务边界

这个服务负责：

1. 校验输入模式是 `contract_address + chain` 还是 `source_bundle`
2. 把源码交给规则引擎分析，输出结构化 findings、风险分和修复建议
3. 统一填充 `sources`、`freshness`、`errors`、`service` 顶层骨架
4. 为后续外部静态分析器接入提供稳定 orchestration 层

这个服务不负责：

1. 替 Gateway 做计费、预算、签名或幂等控制
2. 在 router 里直接写链上抓源码或规则扫描逻辑
3. 用自由文本替代结构化风险对象
4. 在 runtime repository 中偷偷建表或自动迁移

## 3. 当前实现分层

建议并已落地的代码结构：

```text
provider_service/app/
  api/v1/endpoints/smart_contract_audit.py
  schemas/smart_contract_audit.py
  services/smart_contract_audit_service.py
  services/smart_contract_audit/
    adapters.py
    analyzer.py
```

职责拆分：

1. `endpoint`
   - 只做签名校验、日志、请求/响应映射
2. `schema`
   - 只做 request/response contract 和 one-of 输入校验
3. `service`
   - 决定 source_bundle 来自直传还是 verified-source fetcher
   - 负责拼装统一 response 骨架
4. `adapter`
   - 负责请求 Sourcify、解析 verified contract metadata 和 source files
   - 负责 chain -> chainId 映射与外部错误规范化
5. `analyzer`
   - 承担规则定义、命中扫描、证据提取、风险分和攻击面摘要生成
6. `repository`
   - 成功请求把结构化响应写入 `provider_contract_audit_reports`
   - 成功或失败请求都把调用记录写入 `provider_api_invocations`

## 4. 输入模式设计

V1 请求模型严格只允许两种模式二选一：

1. `contract_address + chain`
2. `source_bundle`

校验规则：

1. `contract_address` 必须是标准 EVM 地址
2. `chain` 当前限制在常见 EVM 网络白名单
3. `source_bundle` 必须包含实际 Solidity 源码内容
4. 不允许同时传地址模式和源码模式

这一步必须在 schema 层完成，不把输入歧义留到 service 再猜。

## 5. 规则引擎设计

V1 不直接引入重型审计编排，而是先做 deterministic rule engine。

当前规则集分两档：

1. `fast`
   - `delegatecall`
   - `tx.origin`
   - `selfdestruct`
   - `low-level call`
2. `standard`
   - 在 `fast` 基础上增加 `block.timestamp`
   - 弱随机数
   - 升级入口暴露

每条规则定义：

1. `title`
2. `severity`
3. `description`
4. `suggestion`
5. `category`
6. `regex pattern`
7. 是否属于 `fast_mode`

这样做的价值很直接：

1. 行为稳定，可单测
2. 风险解释可追溯
3. 将来接入 `Slither/Mythril` 时，只需要把它们的结果归并进同一 finding 模型

## 6. 证据与风险分

证据生成策略：

1. 命中规则后提取第一条匹配源码行
2. 生成 `Line N: <code excerpt>` 形式的 evidence
3. `include_evidence=false` 时不返回 evidence

风险分策略：

1. `critical = 35`
2. `high = 20`
3. `medium = 10`
4. `low = 4`
5. 命中 3 条及以上时额外加 5 分
6. 总分上限 100

风险等级：

1. `0-24 -> low`
2. `25-59 -> medium`
3. `60-84 -> high`
4. `85-100 -> critical`

这个分法不装神弄鬼，核心目的是让下游 Agent 有一个稳定的 risk ordering。

## 7. verified-source 扩展点

`contract_address + chain` 模式当前已通过 `Sourcify` 打通。

当前实现：

1. 先请求 Sourcify：`GET /server/v2/contract/{chainId}/{address}?fields=all`
2. 再请求 Sourcify：`GET /server/files/any/{chainId}/{address}`
3. 如果 Sourcify miss，则回退到链级 `Blockscout getsourcecode`
4. 如果 Blockscout 仍 miss，且配置了 `ETHERSCAN_API_KEY`，则继续回退到 `Etherscan getsourcecode`
5. 从返回的 source payload 中提取 Solidity 文件并拼装成统一 `source_bundle`
6. 所有 provider 都 miss 时返回 `404`
7. 取到了 verified contract 但拿不到 Solidity 源文件时返回 `422`

后续建议接法：

1. 当前默认顺序已经是 `Sourcify -> Blockscout -> Etherscan`
2. `Blockscout` 通过 `BLOCKSCOUT_BASE_URLS_JSON` 做链级 base URL 映射
3. `Etherscan` 通过 `ETHERSCAN_API_KEY` 启用，未配置时自动跳过
4. 成功抓到源码后，继续复用同一 `analyze_source_bundle()` 主链

## 8. 调用示例

源码直传模式现在即可调用：

```bash
curl -X POST "http://127.0.0.1:8100/provider-services/smart-contract-audit/invoke" \
  -H "Content-Type: application/json" \
  -H "X-Synapse-Service-Id: svc_smart_contract_audit" \
  -H "X-Synapse-Signed-At: 1710931200" \
  -H "X-Synapse-Signature: <gateway-signature>" \
  -d '{
    "source_bundle": "pragma solidity ^0.8.20; contract RiskyVault { function exec(address target, bytes calldata data) external { (bool ok, ) = target.delegatecall(data); require(ok); } }",
    "analysis_depth": "standard",
    "include_evidence": true
  }'
```

## 9. 单元测试范围

当前测试覆盖：

1. `source_bundle` 成功调用并返回结构化 findings
2. `contract_address + chain` 模式通过 verified-source fallback 链跑通
3. Sourcify adapter 对成功响应和 `404` 响应的解析
4. Blockscout adapter 对 standard-json source code 的解析
5. Etherscan adapter 对 raw Solidity source code 的解析
6. `Sourcify miss -> Blockscout hit` 与 `Blockscout miss -> Etherscan hit` 的 fallback 测试
7. one-of 输入校验
8. Gateway 签名缺失时拒绝请求

此外，当前运行时已经补上真实持久化语义：

1. 成功调用会 upsert `provider_contract_audit_reports`
2. 成功或失败调用都会 append `provider_api_invocations`
3. `request_id` 与 `gateway_request_id` 都会保留下来，便于串联 Gateway 与 Provider 两侧日志
4. `observability_json` 当前会结构化保存 `resolvedSourceProvider` 与 `fallbackAttempts`

这保证了 V1 已经不是“文档驱动开发”，而是可以真实 invoke 的 provider endpoint。

## 10. 下一步演进

下一阶段建议按这个顺序继续推进：

1. 引入 `Slither/Mythril` 结果归并层
2. 补充 raw finding persistence 和回放排障链路
3. 增加 fallback attempts 的 source-level timing / status / payload digest 细化字段

兄弟，这样推进才是基础设施打法：先把主链打直，再加重武器，不反过来。
