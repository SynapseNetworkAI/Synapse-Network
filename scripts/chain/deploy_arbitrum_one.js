const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const hre = require("hardhat");

const CHAIN_ID = 42161n;
const CHAIN_NAME = "Arbitrum One";
const NETWORK_NAME = "arbitrumOne";
const EXPLORER_URL = "https://arbiscan.io";
const EVIDENCE_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "docs",
  "evidence",
  "release",
  "contracts",
  "arbitrum-one",
);
const REPORT_TITLE = "Arbitrum One Contract Deployment Evidence";
const REPORT_NOTES = [
  "Production deploy uses a Ledger-backed deployer signer, not a raw deployer private key.",
  "Production deploy uses the official Arbitrum One USDC address, not MockUSDC.",
  "Evidence intentionally excludes private keys, RPC API keys, raw signatures, JWTs, and admin tokens.",
  "Contract owner must be the production Safe treasury and withdraw signer must be the KMS-derived signer address.",
  "Manual admin approval remains separate from withdrawal ticket signing; Gateway still signs tickets through KMS after approval.",
];

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

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
}

function requireAnyEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(`Missing required env ${names.join(" or ")}`);
}

function requireAddressEnv(name) {
  const value = requireEnv(name);
  if (!hre.ethers.isAddress(value) || value === hre.ethers.ZeroAddress) {
    throw new Error(`${name} must be a non-zero Ethereum address`);
  }
  return hre.ethers.getAddress(value);
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

function artifactFor(contractName) {
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
  return { artifactPath, artifact };
}

function artifactHash(contractName) {
  const { artifact } = artifactFor(contractName);
  return {
    abiHash: sha256(stableStringify(artifact.abi)),
    bytecodeHash: sha256(artifact.bytecode),
  };
}

function extractAddress(text, label) {
  const match = String(text).match(/0x[a-fA-F0-9]{40}/);
  if (!match) {
    throw new Error(`Could not parse ${label} from command output`);
  }
  return hre.ethers.getAddress(match[0]);
}

function extractTxHash(text) {
  const match = String(text).match(/0x[a-fA-F0-9]{64}/);
  if (!match) {
    throw new Error("Could not parse transaction hash from cast output");
  }
  return match[0];
}

function runCommand(command, args, { env, cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function getWalletPreflight({ provider, deployerAddress, minGasWei }) {
  const balanceWei = await provider.getBalance(deployerAddress);
  return {
    chainId: Number(CHAIN_ID),
    wallets: [
      {
        role: "deployer",
        source: "ledger",
        address: deployerAddress,
        balanceEth: hre.ethers.formatEther(balanceWei),
        minRequiredEth: hre.ethers.formatEther(minGasWei),
        pass: balanceWei >= minGasWei,
      },
    ],
  };
}

function renderMarkdown(report) {
  const lines = [
    `# ${REPORT_TITLE}`,
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Chain: ${report.chainName} (${report.chainId})`,
    `- Generated at: ${report.generatedAt}`,
    `- Deployment mode: ${report.deploymentMode}`,
    `- Deployer: ${report.deployer}`,
    `- Contract owner: ${report.owner}`,
    `- Withdraw signer: ${report.withdrawSigner}`,
    `- SynapseCore: ${report.contracts?.synapseCore?.address || "n/a"}`,
    `- Failed checks: ${report.failed.length}`,
    "",
    "## Notes",
    "",
    ...REPORT_NOTES.map((note) => `- ${note}`),
  ];

  if (report.failed.length > 0) {
    lines.push("", "## Failed", "");
    for (const failure of report.failed) {
      lines.push(`- ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const dryRun =
    process.env.SYNAPSE_DEPLOY_DRY_RUN === "1" || process.argv.includes("--dry-run");
  const generatedAt = new Date().toISOString();
  const evidenceDir = path.join(
    EVIDENCE_ROOT,
    `${timestampForPath()}-${dryRun ? "dry-run" : "deploy"}`,
  );
  mkdirp(evidenceDir);

  const failed = [];
  const deploymentTxs = {};
  const verification = {
    contracts: [
      {
        contractName: "SynapseCore",
        status: dryRun ? "not_run_dry_run" : "pending_manual_verify",
      },
    ],
  };

  const rpcUrl = requireEnv("ARBITRUM_ONE_RPC_URL");
  const ownerAddress = requireAddressEnv("PROD_CONTRACT_OWNER_ADDRESS");
  const withdrawSignerAddress = requireAddressEnv("PROD_WITHDRAW_SIGNER_ADDRESS");
  const usdcAddress = requireAddressEnv("PROD_USDC_TOKEN_ADDRESS");
  const ledgerDeployerAddress = requireAddressEnv("PROD_LEDGER_DEPLOYER_ADDRESS");
  const ledgerDerivationPath =
    process.env.PROD_LEDGER_DERIVATION_PATH?.trim() || "m/44'/60'/0'/0/0";
  requireAnyEnv(["ETHERSCAN_API_KEY", "ARBISCAN_API_KEY"]);

  if (ledgerDeployerAddress.toLowerCase() === ownerAddress.toLowerCase()) {
    failed.push("PROD_LEDGER_DEPLOYER_ADDRESS and PROD_CONTRACT_OWNER_ADDRESS must be separate roles");
  }
  if (ledgerDeployerAddress.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push(
      "PROD_LEDGER_DEPLOYER_ADDRESS and PROD_WITHDRAW_SIGNER_ADDRESS must be separate roles",
    );
  }
  if (ownerAddress.toLowerCase() === withdrawSignerAddress.toLowerCase()) {
    failed.push("PROD_CONTRACT_OWNER_ADDRESS and PROD_WITHDRAW_SIGNER_ADDRESS must be separate roles");
  }

  await hre.run("compile");

  const provider = new hre.ethers.JsonRpcProvider(rpcUrl, Number(CHAIN_ID));
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) {
    failed.push(`RPC chainId must be ${CHAIN_ID}, got ${network.chainId}`);
  }

  const minGasWei = hre.ethers.parseEther(process.env.PROD_MIN_GAS_ETH || "0.02");
  const confirmations = Number(process.env.PROD_DEPLOY_CONFIRMATIONS || 10);
  const walletPreflight = await getWalletPreflight({
    provider,
    deployerAddress: ledgerDeployerAddress,
    minGasWei,
  });

  if (!walletPreflight.wallets[0].pass) {
    failed.push("Ledger deployer wallet is below the minimum gas threshold");
  }

  const { artifact: synapseCoreArtifact } = artifactFor("SynapseCore");
  const constructorArgs = [usdcAddress, withdrawSignerAddress, ownerAddress];
  const encodedArgs = hre.ethers.AbiCoder.defaultAbiCoder()
    .encode(["address", "address", "address"], constructorArgs)
    .slice(2);
  const initCode = `${synapseCoreArtifact.bytecode}${encodedArgs}`;

  const manifest = {
    generatedAt,
    dryRun,
    chainId: Number(CHAIN_ID),
    chainName: CHAIN_NAME,
    network: NETWORK_NAME,
    deploymentMode: "ledger",
    deployer: ledgerDeployerAddress,
    owner: ownerAddress,
    withdrawSigner: withdrawSignerAddress,
    usdcTokenAddress: usdcAddress,
    rpc: rpcSummary(rpcUrl),
    contracts: {},
  };

  if (!dryRun) {
    console.log(
      `Resolving Ledger deployer address with path ${ledgerDerivationPath}. Connect the Ledger device and open the Ethereum app if prompted.`,
    );
    const derivedAddressOutput = runCommand(
      "cast",
      [
        "wallet",
        "address",
        "--ledger",
        "--mnemonic-derivation-path",
        ledgerDerivationPath,
      ],
      { cwd: path.resolve(__dirname, "..", "..") },
    );
    const derivedAddress = extractAddress(
      `${derivedAddressOutput.stdout}\n${derivedAddressOutput.stderr}`,
      "Ledger address",
    );
    if (derivedAddress !== ledgerDeployerAddress) {
      failed.push(
        `Ledger derivation path resolved ${derivedAddress}, expected ${ledgerDeployerAddress}`,
      );
    }
  }

  if (failed.length === 0 && !dryRun) {
    console.log(
      `Deploying SynapseCore to ${CHAIN_NAME} with Ledger signer ${ledgerDeployerAddress}. Confirm the deployment transaction on the device when prompted.`,
    );
    const sendOutput = runCommand(
      "cast",
      [
        "send",
        "--async",
        "--json",
        "--ledger",
        "--from",
        ledgerDeployerAddress,
        "--mnemonic-derivation-path",
        ledgerDerivationPath,
        "--rpc-url",
        rpcUrl,
        "--chain",
        String(CHAIN_ID),
        "--create",
        initCode,
      ],
      { cwd: path.resolve(__dirname, "..", "..") },
    );
    const txHash = extractTxHash(`${sendOutput.stdout}\n${sendOutput.stderr}`);
    const receipt = await provider.waitForTransaction(txHash, confirmations);

    if (!receipt) {
      failed.push(`Deployment receipt not found for transaction ${txHash}`);
    } else if (receipt.status !== 1) {
      failed.push(`Deployment transaction ${txHash} failed`);
    } else if (!receipt.contractAddress) {
      failed.push(`Deployment receipt ${txHash} is missing contractAddress`);
    } else {
      const coreAddress = hre.ethers.getAddress(receipt.contractAddress);
      deploymentTxs.synapseCoreDeploy = {
        hash: txHash,
        blockNumber: receipt.blockNumber,
        status: receipt.status,
        contractAddress: coreAddress,
      };

      const coreArtifact = artifactHash("SynapseCore");
      const coreCode = await provider.getCode(coreAddress);
      const core = await hre.ethers.getContractAt("SynapseCore", coreAddress, provider);

      manifest.contracts.synapseCore = {
        address: coreAddress,
        owner: await core.owner(),
        withdrawSigner: await core.platformSigner(),
        usdc: await core.usdc(),
        constructorArgs,
        constructorArgsHash: sha256(stableStringify(constructorArgs)),
        abiHash: coreArtifact.abiHash,
        bytecodeHash: coreArtifact.bytecodeHash,
        deployedCodeHash: hre.ethers.keccak256(coreCode),
        explorerUrl: `${EXPLORER_URL}/address/${coreAddress}`,
      };
    }
  } else {
    const coreArtifact = artifactHash("SynapseCore");
    manifest.contracts.synapseCore = {
      address: "",
      owner: ownerAddress,
      withdrawSigner: withdrawSignerAddress,
      usdc: usdcAddress,
      constructorArgs,
      constructorArgsHash: sha256(stableStringify(constructorArgs)),
      abiHash: coreArtifact.abiHash,
      bytecodeHash: coreArtifact.bytecodeHash,
      deployedCodeHash: "",
      explorerUrl: "",
    };
  }

  const report = {
    generatedAt,
    verificationUpdatedAt: null,
    status: failed.length === 0 ? (dryRun ? "dry_run_success" : "success") : "failed",
    failed,
    environment: dryRun ? "dry-run" : "prod",
    network: NETWORK_NAME,
    chainName: CHAIN_NAME,
    chainId: Number(CHAIN_ID),
    deploymentMode: "ledger",
    deployer: ledgerDeployerAddress,
    owner: ownerAddress,
    withdrawSigner: withdrawSignerAddress,
    contracts: manifest.contracts,
    evidenceDir,
  };

  writeJson(path.join(evidenceDir, "contract-manifest.json"), manifest);
  writeJson(path.join(evidenceDir, "deployment-txs.json"), deploymentTxs);
  writeJson(path.join(evidenceDir, "verification.json"), verification);
  writeJson(path.join(evidenceDir, "wallet-preflight.json"), walletPreflight);
  writeJson(path.join(evidenceDir, "report.json"), report);
  fs.writeFileSync(path.join(evidenceDir, "report.md"), renderMarkdown(report));

  console.log(`${CHAIN_NAME} deployment evidence: ${evidenceDir}`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`FATAL CONTRACT-DEPLOY-001: ${failure}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
