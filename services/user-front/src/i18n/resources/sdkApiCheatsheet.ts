export const sdkAuthMethods = [
  "SynapseAuth.fromWallet(wallet, opts?)",
  "auth.getToken()",
  "auth.issueCredential(opts?)",
  "auth.revokeCredential(id)",
  "auth.updateCredentialQuota(id, opts)",
  "auth.listCredentials()",
  "auth.getBalance()",
  "auth.getUsageLogs()",
  "auth.setSpendingLimit(usdc)",
  "auth.registerDepositIntent(txHash, amount)",
  "auth.confirmDeposit(intentId, eventKey)",
  "auth.getRegistrationGuide()",
  "auth.updateProviderService(id, patch)",
  "auth.createProviderWithdrawalIntent(amount)",
];

export const sdkAuthReturns = [
  "SynapseAuth",
  "Promise<string>",
  "IssueCredentialResult",
  "{ status }",
  "{ status }",
  "AgentCredential[]",
  "BalanceSummary",
  "{ logs }",
  "Promise<void>",
  "DepositIntentResult",
  "{ status }",
  "{ steps }",
  "{ service }",
  "{ intent }",
];

export const sdkClientMethods = [
  "new SynapseClient({ credential, environment? })",
  "client.discover(opts?)",
  "client.search(query, opts?)",
  "client.invoke(serviceId, payload, { costUsdc })",
  "client.invokeWithRediscovery(serviceId, payload, opts)",
  "client.getInvocation(invocationId)",
  "client.waitForInvocation(id, opts?)",
];

export const sdkClientReturns = [
  "SynapseClient",
  "ServiceRecord[]",
  "ServiceRecord[]",
  "InvocationResult",
  "InvocationResult",
  "InvocationResult",
  "InvocationResult",
];

export const sdkPyAuthMethods = [
  "SynapseAuth.from_private_key(key, environment?)",
  "auth.get_token()",
  "auth.issue_credential(name, ...)",
  "auth.revoke_credential(id)",
  "auth.update_credential_quota(id, ...)",
  "auth.list_credentials()",
  "auth.get_balance()",
  "auth.get_usage_logs()",
  "auth.set_spending_limit(usdc)",
  "auth.register_deposit_intent(tx_hash, amount)",
  "auth.confirm_deposit(intent_id, event_key)",
  "auth.get_registration_guide()",
  "auth.update_provider_service(id, patch)",
  "auth.create_provider_withdrawal_intent(amount)",
];

export const sdkPyAuthReturns = [
  "SynapseAuth",
  "str",
  "IssueCredentialResult",
  "dict",
  "dict",
  "list[AgentCredential]",
  "BalanceSummary",
  "dict",
  "None",
  "DepositIntentResult",
  "dict",
  "dict",
  "dict",
  "dict",
];

export const sdkPyClientMethods = [
  "SynapseClient(api_key, environment?)",
  "client.discover(limit?)",
  "client.search(query, limit?)",
  "client.invoke(service_id, payload, *, cost_usdc)",
  "client.invoke_with_rediscovery(service_id, payload, ...)",
  "client.get_invocation(invocation_id)",
];

export const sdkPyClientReturns = [
  "SynapseClient",
  "list[ServiceRecord]",
  "list[ServiceRecord]",
  "InvocationResult",
  "InvocationResult",
  "InvocationResult",
];
