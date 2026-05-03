import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ethers } from "ethers";

const DEPLOYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export function createWithdrawalE2eToolkit({
  root,
  postgresDsn,
  rpcUrl,
  chainId,
  runId,
  fail,
  onChainEvidence = () => {},
}) {
  function sqlLiteral(value) {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
  }

  function decimal(value) {
    return Number.parseFloat(String(value || "0")).toFixed(6);
  }

  function atomic(value) {
    const text = String(value ?? "0").trim();
    const sign = text.startsWith("-") ? -1n : 1n;
    const unsigned = text.replace(/^-/, "");
    const [whole, fraction = ""] = unsigned.split(".");
    return (
      sign *
      (BigInt(whole || "0") * 1_000_000n +
        BigInt(fraction.padEnd(6, "0").slice(0, 6)))
    );
  }

  function ownerId(wallet) {
    return `owner:${String(wallet).toLowerCase()}`;
  }

  function providerId(wallet) {
    return `provider:${String(wallet).toLowerCase()}`;
  }

  function consumerAccount(wallet) {
    return `consumer_wallet::${String(wallet).toLowerCase()}`;
  }

  function providerAccount(wallet) {
    return `provider_wallet::${String(wallet).toLowerCase()}`;
  }

  function psql(args, input = "") {
    if (!postgresDsn) fail("POSTGRES_DSN is required");
    const result = spawnSync(
      "psql",
      [postgresDsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", ...args],
      {
        cwd: root,
        encoding: "utf8",
        input,
      }
    );
    if (result.status !== 0) {
      fail(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
    }
    return result.stdout.trim();
  }

  function execSql(sql) {
    return psql(["-c", sql]);
  }

  function queryJson(sql) {
    const text = execSql(sql);
    return text ? JSON.parse(text) : null;
  }

  function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  }

  async function sendWithRetry(label, makeTx, attempts = 4) {
    let lastError;
    for (let index = 0; index < attempts; index += 1) {
      try {
        return await makeTx();
      } catch (error) {
        lastError = error;
        if (
          !/nonce|replacement|underpriced|already known|transaction underpriced/i.test(
            error.message || ""
          )
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error(
      `${label} failed after retries: ${lastError?.message || lastError}`
    );
  }

  async function getChainContext() {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const actualChainId = Number(network.chainId);
    if (actualChainId !== chainId) {
      fail(`RPC chainId mismatch. Expected ${chainId}, got ${actualChainId}.`);
    }
    const config = readJson("services/user-front/src/contract-config.json");
    return {
      provider,
      chainId: actualChainId,
      coreAddress: ethers.getAddress(config.SynapseCore),
      usdcAddress: ethers.getAddress(config.MockUSDC),
      coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
      usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
    };
  }

  async function fundVaultLiquidity(amountUsdc = "500") {
    const { provider, coreAddress, usdcAddress, usdcAbi } =
      await getChainContext();
    const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
    const usdc = new ethers.Contract(usdcAddress, usdcAbi, deployer);
    const decimals = Number(await usdc.decimals());
    const amount = ethers.parseUnits(amountUsdc, decimals);
    const tx = await sendWithRetry("fund-vault-liquidity", () =>
      usdc.mint(coreAddress, amount)
    );
    const receipt = await tx.wait();
    if (receipt?.status !== 1)
      fail(`fund vault liquidity tx failed: ${tx.hash}`);
    onChainEvidence({
      name: "fund-vault-liquidity",
      txHash: tx.hash,
      amountUsdc,
    });
    return tx.hash;
  }

  async function topUpEthIfNeeded(targetAddress, targetEth = "1.0") {
    const { provider } = await getChainContext();
    const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
    const current = await provider.getBalance(targetAddress);
    const target = ethers.parseEther(targetEth);
    if (current >= target) return "";
    const tx = await sendWithRetry("top-up-withdraw-gas", () =>
      deployer.sendTransaction({ to: targetAddress, value: target - current })
    );
    const receipt = await tx.wait();
    if (receipt?.status !== 1)
      fail(`gas top-up failed for ${targetAddress}: ${tx.hash}`);
    onChainEvidence({
      name: "top-up-withdraw-gas",
      txHash: tx.hash,
      targetAddress,
    });
    return tx.hash;
  }

  async function readChainBalances(address) {
    const { provider, coreAddress, usdcAddress, usdcAbi } =
      await getChainContext();
    const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
    const decimals = Number(await usdc.decimals());
    const walletAtomic = await usdc.balanceOf(address);
    const vaultAtomic = await usdc.balanceOf(coreAddress);
    return {
      decimals,
      walletAtomic: walletAtomic.toString(),
      walletUsdc: ethers.formatUnits(walletAtomic, decimals),
      vaultAtomic: vaultAtomic.toString(),
      vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
    };
  }

  async function isTicketConsumed(ticketHash) {
    const { provider, coreAbi, coreAddress } = await getChainContext();
    const core = new ethers.Contract(coreAddress, coreAbi, provider);
    return Boolean(await core.isTicketConsumed(ticketHash));
  }

  async function claimOnChain(privateKey, ticket) {
    const { provider, coreAbi, coreAddress } = await getChainContext();
    const signer = new ethers.Wallet(privateKey, provider);
    await topUpEthIfNeeded(signer.address, "1.0");
    const core = new ethers.Contract(coreAddress, coreAbi, signer);
    const signature = String(ticket.signature || "").startsWith("0x")
      ? ticket.signature
      : `0x${ticket.signature}`;
    const tx = await sendWithRetry("withdraw-claim", () =>
      core.withdraw(
        BigInt(ticket.amount),
        BigInt(ticket.fee || 0),
        ticket.ticketId,
        BigInt(ticket.deadline),
        signature
      )
    );
    const receipt = await tx.wait();
    if (Number(receipt?.status ?? -1) !== 1)
      fail(`withdraw tx failed ${tx.hash}`);
    return {
      txHash: tx.hash,
      receiptStatus: Number(receipt?.status ?? -1),
      blockNumber: Number(receipt?.blockNumber ?? 0),
      gasUsed: receipt?.gasUsed?.toString?.() || "",
    };
  }

  function ensureOwner(wallet) {
    const lower = String(wallet).toLowerCase();
    execSql(`
      INSERT INTO synapse_owner_accounts (owner_id, owner_wallet, status, default_currency, created_at, updated_at)
      VALUES (${sqlLiteral(ownerId(lower))}, ${sqlLiteral(
      lower
    )}, 'active', 'USDC', NOW(), NOW())
      ON CONFLICT (owner_id)
      DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = NOW();
    `);
  }

  function ensureAccount(
    wallet,
    kind,
    available = "0",
    pending = "0",
    frozen = "0"
  ) {
    const lower = String(wallet).toLowerCase();
    ensureOwner(lower);
    if (kind === "provider") {
      execSql(`
        INSERT INTO synapse_provider_profiles (provider_id, owner_id, display_name, status, created_at, updated_at)
        VALUES (${sqlLiteral(providerId(lower))}, ${sqlLiteral(
        ownerId(lower)
      )}, ${sqlLiteral(lower)}, 'active', NOW(), NOW())
        ON CONFLICT (provider_id)
        DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = NOW();
      `);
    }
    const accountId =
      kind === "provider" ? providerAccount(lower) : consumerAccount(lower);
    const accountKind =
      kind === "provider" ? "provider_wallet" : "consumer_wallet";
    const providerValue =
      kind === "provider" ? sqlLiteral(providerId(lower)) : "NULL";
    execSql(`
      INSERT INTO synapse_ledger_accounts (
        account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
      ) VALUES (
        ${sqlLiteral(accountId)}, ${sqlLiteral(accountKind)}, ${sqlLiteral(
      ownerId(lower)
    )}, ${providerValue}, 'USDC', 'active', NOW(), NOW()
      )
      ON CONFLICT (account_id)
      DO UPDATE SET owner_id = EXCLUDED.owner_id, provider_id = EXCLUDED.provider_id, updated_at = NOW();

      INSERT INTO synapse_account_balances (
        account_id, available_balance, pending_balance, frozen_balance, updated_at
      ) VALUES (
        ${sqlLiteral(accountId)}, ${sqlLiteral(
      decimal(available)
    )}, ${sqlLiteral(decimal(pending))}, ${sqlLiteral(decimal(frozen))}, NOW()
      )
      ON CONFLICT (account_id)
      DO UPDATE SET
        available_balance = EXCLUDED.available_balance,
        pending_balance = EXCLUDED.pending_balance,
        frozen_balance = EXCLUDED.frozen_balance,
        updated_at = NOW();
    `);
  }

  function ensurePlatformAccount() {
    execSql(`
      INSERT INTO synapse_ledger_accounts (
        account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
      ) VALUES ('platform_revenue::main', 'platform_revenue', NULL, NULL, 'USDC', 'active', NOW(), NOW())
      ON CONFLICT (account_id) DO UPDATE SET updated_at = NOW();
    `);
  }

  function insertDeposit(wallet, amount, ageSeconds, label) {
    const lower = String(wallet).toLowerCase();
    const depositId = `${runId}:dep:${label}`;
    execSql(`
      INSERT INTO synapse_vault_deposits (
        deposit_id, owner_id, owner_address, target_account_id, tx_hash, amount_usdc, status, created_at, updated_at
      ) VALUES (
        ${sqlLiteral(depositId)}, ${sqlLiteral(ownerId(lower))}, ${sqlLiteral(
      lower
    )}, ${sqlLiteral(consumerAccount(lower))},
        ${sqlLiteral(
          `0x${crypto.createHash("sha256").update(depositId).digest("hex")}`
        )},
        ${sqlLiteral(decimal(amount))}, 'CONFIRMED',
        NOW() - (${Number(ageSeconds)} * INTERVAL '1 second'),
        NOW() - (${Number(ageSeconds)} * INTERVAL '1 second')
      )
      ON CONFLICT (deposit_id) DO NOTHING;
    `);
  }

  function insertConsumerSpend(wallet, amount, label) {
    const lower = String(wallet).toLowerCase();
    const entryId = `${runId}:spend:${label}`;
    ensurePlatformAccount();
    execSql(`
      INSERT INTO synapse_ledger_entries (
        entry_id, reference_type, reference_id, business_type, debit_account_id, credit_account_id, amount_usdc, status, created_at
      ) VALUES (
        ${sqlLiteral(entryId)}, 'e2e', ${sqlLiteral(entryId)}, 'charge',
        ${sqlLiteral(
          consumerAccount(lower)
        )}, 'platform_revenue::main', ${sqlLiteral(
      decimal(amount)
    )}, 'posted', NOW()
      )
      ON CONFLICT (entry_id) DO NOTHING;
    `);
  }

  function insertProviderIncome(wallet, amount, ageSeconds, label) {
    const lower = String(wallet).toLowerCase();
    const entryId = `${runId}:income:${label}`;
    ensurePlatformAccount();
    execSql(`
      INSERT INTO synapse_ledger_entries (
        entry_id, reference_type, reference_id, business_type, debit_account_id, credit_account_id, amount_usdc, status, created_at
      ) VALUES (
        ${sqlLiteral(entryId)}, 'e2e', ${sqlLiteral(entryId)}, 'charge',
        'platform_revenue::main', ${sqlLiteral(
          providerAccount(lower)
        )}, ${sqlLiteral(decimal(amount))},
        'posted', NOW() - (${Number(ageSeconds)} * INTERVAL '1 second')
      )
      ON CONFLICT (entry_id) DO NOTHING;
    `);
  }

  return {
    atomic,
    claimOnChain,
    consumerAccount,
    decimal,
    ensureAccount,
    ensureOwner,
    ensurePlatformAccount,
    execSql,
    fundVaultLiquidity,
    getChainContext,
    insertConsumerSpend,
    insertDeposit,
    insertProviderIncome,
    isTicketConsumed,
    ownerId,
    providerAccount,
    providerId,
    psql,
    queryJson,
    readChainBalances,
    readJson,
    sendWithRetry,
    sqlLiteral,
    topUpEthIfNeeded,
  };
}
