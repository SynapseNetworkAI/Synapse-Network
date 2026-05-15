const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");

function timestampForPath() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rpcSummary(rawUrl) {
  const url = new URL(rawUrl);
  const redactedPath = url.pathname.replace(/\/v2\/[^/]+/i, "/v2/[REDACTED]");
  return {
    protocol: url.protocol,
    host: url.host,
    path: redactedPath || "/",
  };
}

function artifactHash(contractName) {
  const artifactPath = path.resolve(
    __dirname,
    "..",
    "..",
    "artifacts",
    "contracts",
    `${contractName}.sol`,
    `${contractName}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return {
    abiHash: sha256(stableStringify(artifact.abi)),
    bytecodeHash: sha256(artifact.bytecode),
  };
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyVerified(error) {
  const text = String(error && (error.message || error));
  return /already verified|already been verified|contract source code already verified/i.test(text);
}

function isInvalidExplorerApiKey(error) {
  const text = String(error && (error.message || error));
  return /invalid api key|deprecated v1 endpoint|switch to etherscan api v2/i.test(text);
}

async function verifyWithRetry({
  explorerUrl,
  contractName,
  address,
  constructorArguments,
  retries,
  retryDelayMs,
}) {
  const attempts = [];

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments,
      });
      attempts.push({ attempt, status: "success" });
      return {
        contractName,
        address,
        status: "success",
        attempts,
        explorerUrl: `${explorerUrl}/address/${address}#code`,
      };
    } catch (error) {
      if (isAlreadyVerified(error)) {
        attempts.push({ attempt, status: "already_verified" });
        return {
          contractName,
          address,
          status: "already_verified",
          attempts,
          explorerUrl: `${explorerUrl}/address/${address}#code`,
        };
      }

      if (isInvalidExplorerApiKey(error)) {
        attempts.push({
          attempt,
          status: "failed",
          error:
            "Invalid explorer API key. Use an Etherscan API V2 key; old Arbiscan/chain-specific keys are rejected.",
        });
        break;
      }

      attempts.push({
        attempt,
        status: "failed",
        error: String(error && (error.message || error)).slice(0, 600),
      });

      if (attempt < retries) {
        await delay(retryDelayMs);
      }
    }
  }

  return {
    contractName,
    address,
    status: "failed",
    attempts,
    explorerUrl: `${explorerUrl}/address/${address}#code`,
  };
}

module.exports = {
  artifactHash,
  delay,
  mkdirp,
  rpcSummary,
  sha256,
  stableStringify,
  timestampForPath,
  verifyWithRetry,
  writeJson,
};
