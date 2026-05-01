function credentialIssueBody(name) {
  return {
    name,
    maxCalls: 20,
    rpm: 60,
    creditLimit: "1.000000",
    resetInterval: "daily",
  };
}

export async function ensureLocalAgentCredential({
  isStaging,
  credential,
  authenticatedProviderJson,
  localProviderWallet,
  runId,
  invokeEvidence,
  addCheck,
}) {
  if (isStaging || credential) return credential;
  const name = `gateway-pull-health-${runId.slice(-8)}`;
  let result = await authenticatedProviderJson("/v1/credentials/agent/issue", {
    method: "POST",
    ownerWallet: localProviderWallet,
    body: credentialIssueBody(name),
  });

  if (
    result.status === 409 &&
    String(result.json?.detail?.code || result.json?.code || "").includes(
      "AGENT_CREDENTIAL_LIMIT_REACHED"
    )
  ) {
    const list = await authenticatedProviderJson(
      "/v1/credentials/agent/list?active_only=true",
      { ownerWallet: localProviderWallet }
    );
    const credentials = Array.isArray(list.json?.credentials)
      ? list.json.credentials
      : [];
    const candidate =
      credentials.find((row) =>
        String(row.name || "").startsWith("gateway-pull-health-")
      ) ||
      credentials.find((row) =>
        String(row.name || "").startsWith("provider-gpp-e2e-local-")
      ) ||
      credentials[0];
    if (candidate?.id) {
      const cleanup = await authenticatedProviderJson(
        `/v1/credentials/agent/${encodeURIComponent(candidate.id)}/delete`,
        { method: "POST", ownerWallet: localProviderWallet }
      );
      addCheck(
        "local_agent_credential_slot_reclaimed",
        cleanup.ok,
        { deletedCredentialId: candidate.id, status: cleanup.status },
        "Local dogfood could not reclaim an old test credential slot."
      );
      result = await authenticatedProviderJson("/v1/credentials/agent/issue", {
        method: "POST",
        ownerWallet: localProviderWallet,
        body: credentialIssueBody(name),
      });
    }
  }

  const issuedCredential = result.json?.credential?.token || "";
  invokeEvidence.credentialIssuedByRunner = Boolean(issuedCredential);
  addCheck(
    "local_agent_credential_available",
    result.ok && Boolean(issuedCredential),
    {
      status: result.status,
      tokenPrefix: result.json?.credential?.tokenPrefix,
    },
    "Local no-hold invoke requires a valid agent credential."
  );
  return issuedCredential;
}
