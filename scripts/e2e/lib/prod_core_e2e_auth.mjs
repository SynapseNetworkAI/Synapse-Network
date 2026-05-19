import { spawnSync } from "node:child_process";
import { env, sanitize } from "./prod_core_e2e_support.mjs";

async function loadEthers(fatal) {
  try {
    return await import("ethers");
  } catch {
    fatal(
      "Production wallet auth requires the ethers package. Run from an environment with root dependencies installed."
    );
  }
}

export function createProdCoreAuthHelpers({
  api,
  addCheck,
  config,
  dbReaders,
  evidence,
  fatal,
  mode,
}) {
  function storeIssuedCredentialSecret(token) {
    const secretName = env("PROD_E2E_AGENT_CREDENTIAL_SECRET_NAME", "");
    if (!secretName) return;
    const project = env("PROD_GCP_PROJECT_ID", "synapse-network-prod");
    const describe = spawnSync(
      "gcloud",
      ["secrets", "describe", secretName, "--project", project],
      { encoding: "utf8" }
    );
    if (describe.status !== 0) {
      const created = spawnSync(
        "gcloud",
        [
          "secrets",
          "create",
          secretName,
          "--project",
          project,
          "--replication-policy=automatic",
          "--labels=environment=prod,managed_by=prod_core_e2e",
        ],
        { encoding: "utf8" }
      );
      if (created.status !== 0) {
        fatal(
          `Unable to create Secret Manager secret ${secretName}: ${(
            created.stderr || created.stdout
          ).trim()}`
        );
      }
    }
    const added = spawnSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "add",
        secretName,
        "--project",
        project,
        "--data-file=-",
      ],
      { input: token, encoding: "utf8" }
    );
    if (added.status !== 0) {
      fatal(
        `Unable to store issued credential in Secret Manager ${secretName}: ${(
          added.stderr || added.stdout
        ).trim()}`
      );
    }
    addCheck("credential:stored-in-secret-manager", true, {
      secretName,
      project,
    });
  }

  async function authenticateOwner() {
    const { ethers } = await loadEthers(fatal);
    const wallet = new ethers.Wallet(config.consumerPrivateKey);
    const challenge = await api(
      `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
    );
    const message = challenge.payload.challenge || challenge.payload.message;
    if (!message) fatal("prod auth challenge missing message");
    const signature = await wallet.signMessage(message);
    const domainOk =
      message.includes("synapse-network.ai") &&
      !message.includes("www.synapse-network.ai");
    addCheck("auth:siwe-domain", domainOk, {
      wallet: wallet.address,
      messageExcerpt: message.slice(0, 260),
    });
    const verified = await api("/v1/auth/verify", {
      method: "POST",
      body: { wallet_address: wallet.address, message, signature },
    });
    const token =
      verified.payload.access_token ||
      verified.payload.token ||
      verified.payload.accessToken;
    if (!token) fatal("prod auth verify missing token");
    return {
      address: wallet.address,
      token,
      expiresAt: Date.now() + 86_400_000,
    };
  }

  async function ensureAgentCredential(auth) {
    if (config.agentCredential) {
      if (config.sqlDsn) {
        const credential = dbReaders.readCredentialDb(config.agentCredential);
        evidence.db.credential = credential;
        addCheck(
          "credential:owned-by-test-wallet",
          String(credential?.ownerWallet || "").toLowerCase() ===
            auth.address.toLowerCase(),
          {
            credentialStatus: credential?.status,
            ownerWallet: credential?.ownerWallet,
            evidence: "sql-evidence.json",
          }
        );
      } else {
        addCheck("credential:provided", true, {
          note: "Credential token was provided by environment and redacted from evidence.",
        });
      }
      return config.agentCredential;
    }
    if (!config.issueCredentialIfMissing) {
      fatal(
        "PROD_E2E_AGENT_CREDENTIAL is missing. Set it to the reusable production E2E credential or set PROD_E2E_ISSUE_AGENT_CREDENTIAL=1 to issue one with the test wallet."
      );
    }
    const result = await api("/v1/credentials/agent/issue", {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body: {
        name: env("PROD_E2E_AGENT_CREDENTIAL_NAME", "prod-core-e2e-agent"),
        rpm: Number(env("PROD_E2E_AGENT_CREDENTIAL_RPM", "600")),
        maxCalls: Number(env("PROD_E2E_AGENT_CREDENTIAL_MAX_CALLS", "1000000")),
        creditLimit: env(
          "PROD_E2E_AGENT_CREDENTIAL_CREDIT_LIMIT_USDC",
          mode === "free-invoke" ? "1.00" : config.depositUsdc
        ),
        resetInterval: env("PROD_E2E_AGENT_CREDENTIAL_RESET_INTERVAL", "never"),
      },
    });
    const credential = result.payload.credential || result.payload;
    const token =
      credential.token ||
      credential.raw_token ||
      credential.rawToken ||
      credential.secretKey ||
      credential.agentToken;
    if (!token) fatal("Credential issue response missing raw token.");
    config.agentCredential = token;
    evidence.credential = sanitize({
      id: credential.id || credential.credentialId,
      tokenPrefix: credential.tokenPrefix || credential.secretPrefix,
      issuedByRunner: true,
      expiresInSec: credential.expiresInSec || null,
    });
    addCheck("credential:issued-indefinite", true, {
      id: credential.id || credential.credentialId,
      tokenPrefix: credential.tokenPrefix || credential.secretPrefix,
      note: "No expiresInSec/expiration was sent by the runner.",
    });
    storeIssuedCredentialSecret(token);
    if (env("PROD_E2E_PRINT_ISSUED_CREDENTIAL_ONCE") === "1") {
      console.log(`[prod-core-e2e] ISSUED PROD_E2E_AGENT_CREDENTIAL=${token}`);
      console.log(
        "[prod-core-e2e] Store this once in Secret Manager/local env; evidence remains redacted."
      );
    }
    return token;
  }

  return { authenticateOwner, ensureAgentCredential };
}
