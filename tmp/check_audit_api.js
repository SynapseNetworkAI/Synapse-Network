const { ethers } = require("ethers");
const GATEWAY = "http://127.0.0.1:8000/api";
async function run() {
  const w = new ethers.Wallet("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
  const addr = w.address.toLowerCase();
  const c = await fetch(GATEWAY + "/v1/auth/challenge?address=" + addr).then(r => r.json());
  const sig = await w.signMessage(c.challenge);
  const v = await fetch(GATEWAY + "/v1/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet_address: addr, signature: sig, message: c.challenge }),
  }).then(r => r.json());
  const token = v.token || v.access_token;
  const logs = await fetch(GATEWAY + "/v1/finance/audit-logs?limit=10", {
    headers: { Authorization: "Bearer " + token, "X-User-Address": addr },
  }).then(r => r.json());
  console.log("Total logs:", (logs.logs || []).length);
  for (const log of logs.logs || []) {
    console.log(JSON.stringify({
      action: log.action,
      deltaAmount: log.details?.deltaAmount,
      amountUsdc: log.details?.amountUsdc,
      beforeBalance: log.details?.beforeBalance,
      afterBalance: log.details?.afterBalance,
    }));
  }
}
run();
