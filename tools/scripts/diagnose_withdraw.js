/**
 * withdrawal diagnosis script — tests balance deduction and repeat-withdraw guard
 */
"use strict";
const { ethers } = require("../../node_modules/ethers");

const ADDR = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const KEY  = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const GW   = "http://localhost:8000/api/v1";
const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", RESET = "\x1b[0m";
const ok   = (m) => console.log(`  ${GREEN}✓${RESET} ${m}`);
const fail = (m) => console.log(`  ${RED}✗${RESET} ${m}`);
const info = (m) => console.log(`  ${YELLOW}→${RESET} ${m}`);

async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json();
  return { status: r.status, ok: r.ok, body };
}

async function main() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const chalRes = await fetchJSON(`${GW}/auth/challenge?address=${ADDR}`);
  const challenge = chalRes.body.challenge;
  const wallet = new ethers.Wallet(KEY);
  const sig = await wallet.signMessage(challenge);
  const authRes = await fetchJSON(`${GW}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet_address: ADDR, message: challenge, signature: sig }),
  });
  const token = authRes.body.access_token;
  if (!token) { fail("Auth failed: " + JSON.stringify(authRes.body)); process.exit(1); }
  ok(`Authenticated ${ADDR.slice(0,18)}…`);

  const hdrs = { "X-Wallet-Address": ADDR, "Authorization": `Bearer ${token}` };
  const jsonHdrs = { ...hdrs, "Content-Type": "application/json" };

  // ── Balance before ────────────────────────────────────────────────────────
  const { body: bal1 } = await fetchJSON(`${GW}/balance`, { headers: hdrs });
  const b1 = bal1.balance || {};
  info(`Balance BEFORE: available=${b1.consumerAvailableBalance} pending=${b1.consumerPendingBalance}`);

  if (!b1.consumerAvailableBalance || b1.consumerAvailableBalance < 2) {
    fail("Need ≥2 USDC in available balance for this test. Run fullchain_wallet_test.js first.");
    process.exit(1);
  }

  // ── Withdraw $1 ───────────────────────────────────────────────────────────
  const idem1 = `diag-${Date.now()}`;
  const { status: s1, body: wd1 } = await fetchJSON(`${GW}/balance/consumer/withdraw`, {
    method: "POST",
    headers: { ...jsonHdrs, "X-Idempotency-Key": idem1 },
    body: JSON.stringify({ amountUsdc: 1.0, reason: "diagnosis test" }),
  });
  if (s1 === 200 || s1 === 201) {
    ok(`Withdraw #1: status=${wd1.status} id=${wd1.withdrawId} risk=${wd1.riskLevel}`);
  } else {
    fail(`Withdraw #1 returned ${s1}: ${JSON.stringify(wd1)}`);
    process.exit(1);
  }

  // ── Balance after withdraw #1 ─────────────────────────────────────────────
  await new Promise(r => setTimeout(r, 300));
  const { body: bal2 } = await fetchJSON(`${GW}/balance`, { headers: hdrs });
  const b2 = bal2.balance || {};
  info(`Balance AFTER #1: available=${b2.consumerAvailableBalance} pending=${b2.consumerPendingBalance}`);

  const expectedAvail = Math.round((b1.consumerAvailableBalance - 1.0) * 1e6) / 1e6;
  const actualAvail   = Math.round((b2.consumerAvailableBalance || 0) * 1e6) / 1e6;
  if (Math.abs(actualAvail - expectedAvail) < 0.0001) {
    ok(`Balance deducted correctly: ${b1.consumerAvailableBalance} → ${b2.consumerAvailableBalance}`);
  } else {
    fail(`BUG: Balance NOT deducted! Expected ≈${expectedAvail}, got ${actualAvail}`);
  }

  const expectedPending =
    Math.round(((b1.consumerPendingBalance || 0) + 1.0) * 1e6) / 1e6;
  const actualPending = Math.round((b2.consumerPendingBalance || 0) * 1e6) / 1e6;
  if (Math.abs(actualPending - expectedPending) < 0.0001) {
    ok(`Pending balance increased correctly: ${b1.consumerPendingBalance} → ${b2.consumerPendingBalance}`);
  } else {
    fail(`BUG: Pending NOT increased! Expected ≈${expectedPending}, got ${actualPending}`);
  }

  // ── Idempotency: same key → same result ───────────────────────────────────
  const { status: s_idem, body: wd_idem } = await fetchJSON(`${GW}/balance/consumer/withdraw`, {
    method: "POST",
    headers: { ...jsonHdrs, "X-Idempotency-Key": idem1 },
    body: JSON.stringify({ amountUsdc: 1.0, reason: "diagnosis test" }),
  });
  if ((s_idem === 200 || s_idem === 201) && wd_idem.withdrawId === wd1.withdrawId) {
    ok(`Idempotency OK: same key → same withdrawId=${wd1.withdrawId}`);
  } else {
    fail(`Idempotency FAILED: status=${s_idem} body=${JSON.stringify(wd_idem).slice(0,150)}`);
  }

  // ── Repeat withdraw (NEW key) → should be BLOCKED (pending exists) ────────
  const idem2 = `diag-${Date.now()}-repeat`;
  const { status: s2, body: wd2 } = await fetchJSON(`${GW}/balance/consumer/withdraw`, {
    method: "POST",
    headers: { ...jsonHdrs, "X-Idempotency-Key": idem2 },
    body: JSON.stringify({ amountUsdc: 1.0, reason: "repeat attempt" }),
  });
  if (s2 === 200 || s2 === 201) {
    if (wd2.withdrawId === wd1.withdrawId) {
      ok(`Repeat withdraw correctly returned existing pending withdrawal (not a new one)`);
    } else {
      fail(`BUG: Repeat withdraw created a NEW intent! id=${wd2.withdrawId} (original=${wd1.withdrawId})`);
      info(`This means a consumer can withdraw more than their available balance`);
    }
  } else {
    fail(`Repeat withdraw returned ${s2}: ${JSON.stringify(wd2).slice(0,150)}`);
  }

  // ── Balance after repeat attempt ──────────────────────────────────────────
  await new Promise(r => setTimeout(r, 300));
  const { body: bal3 } = await fetchJSON(`${GW}/balance`, { headers: hdrs });
  const b3 = bal3.balance || {};
  info(`Balance after repeat: available=${b3.consumerAvailableBalance} pending=${b3.consumerPendingBalance}`);
  if (Math.abs((b3.consumerAvailableBalance || 0) - (b2.consumerAvailableBalance || 0)) < 0.0001) {
    ok(`Balance unchanged after repeat attempt — correct`);
  } else {
    fail(`BUG: Balance changed again after repeat: ${b2.consumerAvailableBalance} → ${b3.consumerAvailableBalance}`);
  }

  // ── List withdrawals ──────────────────────────────────────────────────────
  const { body: wdList } = await fetchJSON(`${GW}/balance/consumer/withdrawals`, { headers: hdrs });
  const count = (wdList.withdrawals || []).length;
  info(`Withdrawal list: ${count} record(s)`);
  const first = (wdList.withdrawals || [])[0] || {};
  info(`  latest: id=${first.id} amount=${first.amountUsdc} status=${first.status}`);

  console.log("\n  Summary complete.");
}

main().catch(e => { fail("FATAL: " + e.message); console.error(e.stack); process.exit(1); });
