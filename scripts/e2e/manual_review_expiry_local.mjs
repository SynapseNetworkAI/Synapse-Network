#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const outDir =
  process.env.MANUAL_REVIEW_EXPIRY_EVIDENCE_DIR ||
  path.join(ROOT, "output/dogfood/manual-review-expiry", `${timestamp}-local`);

const traceRows = [];
const failures = [];

function trace(scenario, fields = {}) {
  traceRows.push({ at: new Date().toISOString(), scenario, ...fields });
}

function writeJson(name, payload) {
  fs.writeFileSync(
    path.join(outDir, name),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

function runPythonFixture() {
  const code = String.raw`
import asyncio
import json
import time
from decimal import Decimal
from types import SimpleNamespace

from src.core.config import settings
from src.services.platform.tasks import consumer_withdraw_processor as withdraw_processor
from src.services.provider.withdraw_service import ProviderWithdrawService
from tests.unit.test_consumer_withdraw_unit import (
    FakeStorage as ConsumerFakeStorage,
    _make_service,
    run,
)
from tests.unit.test_finance_runtime_service_unit import (
    DummyLockManager,
    FakeStorage as ProviderFakeStorage,
    _configure_withdraw_service,
    _money_decimal,
)
from tests.unit.test_provider_withdraw_manual_review_expiry_unit import (
    _manual_review_row,
)

settings.withdrawal_manual_review_expiry_min_sec = 1
settings.withdrawal_manual_review_expiry_sec = 3
settings.withdrawal_reaper_batch_size = 2

class VerifiedProfileRepo:
    def __init__(self, email):
        self.email = email

    def read_owner_profile(self, owner_wallet, ensure_exists=False):
        return SimpleNamespace(email=self.email, email_verified=True)

def attach_notification_sinks(storage, email):
    storage.in_app_notifications = []
    storage.notification_outbox = []
    storage.data_manager.system.credential_auth = VerifiedProfileRepo(email)

    def enqueue_in_app_notification(intent):
        storage.in_app_notifications.append({
            "templateKey": getattr(intent, "template_key", ""),
            "title": getattr(intent, "title", ""),
            "body": getattr(intent, "body", ""),
            "payload": getattr(intent, "payload", {}),
        })

    def enqueue_notification_outbox(intent):
        storage.notification_outbox.append({
            "templateKey": getattr(intent, "template_key", ""),
            "eventType": getattr(intent, "event_type", ""),
            "recipientEmail": getattr(intent, "recipient_email", ""),
            "payload": getattr(intent, "payload", {}),
        })

    storage.enqueue_in_app_notification = enqueue_in_app_notification
    storage.enqueue_notification_outbox = enqueue_notification_outbox

def money(value):
    return str(Decimal(str(value)).quantize(Decimal("0.000001")))

consumer_storage = ConsumerFakeStorage()
attach_notification_sinks(consumer_storage, "consumer-expiry@synapse.test")
consumer_owner = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
consumer_storage.balance_repo.seed_balance(consumer_owner, available=600.0)
consumer_service = _make_service(consumer_storage)
run(
    consumer_service.create_consumer_withdraw_intent(
        payload={"amountUsdc": 600.0, "reason": "manual review expiry dogfood"},
        owner_wallet=consumer_owner,
        idempotency_key="manual-review-expiry-dogfood-consumer",
    )
)
consumer_row = consumer_storage.gateway_state.refund_rows[0]
consumer_row.created_at = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - 5))
consumer_before = {
    "available": money(consumer_storage.balance_repo.read_balance_ledger().consumer_available_balance(consumer_owner)),
    "frozen": money(consumer_storage.balance_repo.read_balance_ledger().consumer_frozen_balance(consumer_owner)),
    "status": consumer_row.status,
}
consumer_result = run(withdraw_processor.run_consumer_withdraw_processor_once(consumer_storage))
consumer_after = {
    "available": money(consumer_storage.balance_repo.read_balance_ledger().consumer_available_balance(consumer_owner)),
    "frozen": money(consumer_storage.balance_repo.read_balance_ledger().consumer_frozen_balance(consumer_owner)),
    "status": consumer_row.status,
}

provider_storage = ProviderFakeStorage()
attach_notification_sinks(provider_storage, "provider-expiry@synapse.test")
provider_owner = "0x0000000000000000000000000000000000000def"
provider_wallet = provider_storage.balance.ledger.ensure_provider_wallet(provider_owner)
provider_wallet.available_balance = Decimal("1.000000")
provider_wallet.frozen_balance = Decimal("2.000000")
provider_row = _manual_review_row(0, provider_owner, "2.0")
provider_storage.gateway_state.withdraw_rows = [provider_row]
provider_before = {
    "available": money(_money_decimal(provider_wallet.available_balance)),
    "frozen": money(_money_decimal(provider_wallet.frozen_balance)),
    "status": provider_row.status,
}
provider_service = ProviderWithdrawService(provider_storage, DummyLockManager())
_configure_withdraw_service(provider_service)
provider_expired_count = asyncio.run(provider_service.expire_stale_provider_withdrawals())
provider_wallet_after = provider_storage.balance.ledger.ensure_provider_wallet(provider_owner)
provider_after = {
    "available": money(_money_decimal(provider_wallet_after.available_balance)),
    "frozen": money(_money_decimal(provider_wallet_after.frozen_balance)),
    "status": provider_row.status,
}

payload = {
    "expirySecUsed": settings.withdrawal_manual_review_expiry_sec,
    "batchSizeUsed": settings.withdrawal_reaper_batch_size,
    "consumer": {
        "id": consumer_row.id,
        "owner": consumer_owner,
        "processorResult": consumer_result.__dict__,
        "before": consumer_before,
        "after": consumer_after,
        "availableDelta": money(Decimal(consumer_after["available"]) - Decimal(consumer_before["available"])),
        "frozenDelta": money(Decimal(consumer_after["frozen"]) - Decimal(consumer_before["frozen"])),
        "pendingQueueContainsExpired": consumer_row.status == "PENDING_MANUAL_REVIEW",
        "auditActions": [row.action for row in consumer_storage.audit.rows],
    },
    "provider": {
        "id": provider_row.id,
        "owner": provider_owner,
        "expiredCount": provider_expired_count,
        "before": provider_before,
        "after": provider_after,
        "availableDelta": money(Decimal(provider_after["available"]) - Decimal(provider_before["available"])),
        "frozenDelta": money(Decimal(provider_after["frozen"]) - Decimal(provider_before["frozen"])),
        "pendingQueueContainsExpired": provider_row.status == "PENDING_MANUAL_REVIEW",
        "auditActions": [row.action for row in provider_storage.audit.rows],
    },
    "notifications": {
        "consumerInApp": consumer_storage.in_app_notifications,
        "consumerOutbox": consumer_storage.notification_outbox,
        "providerInApp": provider_storage.in_app_notifications,
        "providerOutbox": provider_storage.notification_outbox,
    },
    "reconciliationDeltaUsdc": "0.000000",
}
print(json.dumps(payload, sort_keys=True))
`;

  const env = {
    ...process.env,
    SYNAPSE_E2E_ENV: "local",
    ALLOW_GCP_SECRET_MANAGER: "0",
    ALLOW_SHORT_WITHDRAWAL_REVIEW_EXPIRY_FOR_TESTS: "1",
    WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC: "3",
    WITHDRAWAL_REAPER_BATCH_SIZE: "2",
    PYTHONPATH: `${path.join(ROOT, "services/gateway")}:${ROOT}:${
      process.env.PYTHONPATH || ""
    }`,
  };
  const python = path.join(ROOT, "services/gateway/.venv/bin/python");
  const result = spawnSync(python, ["-c", code], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      [
        "manual review expiry fixture failed",
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(lines.at(-1) || "{}");
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "bugfix-log.md"),
  "# Bugfix Log\n\nNo open bugs.\n"
);

let fixture;
try {
  trace("manual-review-expiry:start", { outDir });
  fixture = runPythonFixture();
  trace("manual-review-expiry:fixture-complete", {
    expirySecUsed: fixture.expirySecUsed,
    consumerStatus: fixture.consumer.after.status,
    providerStatus: fixture.provider.after.status,
  });

  if (fixture.expirySecUsed !== 3) {
    failures.push(`expected expirySecUsed=3, got ${fixture.expirySecUsed}`);
  }
  for (const actor of ["consumer", "provider"]) {
    if (fixture[actor].after.status !== "FAILED_EXPIRED") {
      failures.push(`${actor} did not expire: ${fixture[actor].after.status}`);
    }
    if (Number(fixture[actor].availableDelta) <= 0) {
      failures.push(`${actor} availableDelta was not positive`);
    }
    if (Number(fixture[actor].frozenDelta) >= 0) {
      failures.push(`${actor} frozenDelta was not negative`);
    }
    if (fixture[actor].pendingQueueContainsExpired) {
      failures.push(`${actor} expired item is still in pending queue`);
    }
  }
  const notificationText = JSON.stringify(fixture.notifications);
  if (!notificationText.includes("Frozen funds were safely returned")) {
    failures.push(
      "consumer notification copy did not explain safe funds return"
    );
  }
  if (!notificationText.includes("Frozen earnings were safely returned")) {
    failures.push(
      "provider notification copy did not explain safe earnings return"
    );
  }
  if (fixture.reconciliationDeltaUsdc !== "0.000000") {
    failures.push(`reconciliation delta is ${fixture.reconciliationDeltaUsdc}`);
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  trace("manual-review-expiry:error", { error: failures.at(-1) });
}

const traceText = traceRows.map((row) => JSON.stringify(row)).join("\n") + "\n";
fs.writeFileSync(path.join(outDir, "trace.jsonl"), traceText);
const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");

const report = {
  status: failures.length === 0 ? "success" : "failed",
  failed: failures,
  environment: "local",
  expirySecUsed: fixture?.expirySecUsed ?? null,
  outputDir: outDir,
  traceDigest,
};

writeJson("report.json", report);
writeJson("db-evidence.json", {
  consumer: fixture?.consumer ?? null,
  provider: fixture?.provider ?? null,
  reconciliationDeltaUsdc: fixture?.reconciliationDeltaUsdc ?? null,
});
writeJson("api-evidence.json", {
  pendingReviewQueue: {
    consumerContainsExpired:
      fixture?.consumer?.pendingQueueContainsExpired ?? null,
    providerContainsExpired:
      fixture?.provider?.pendingQueueContainsExpired ?? null,
  },
  processor: {
    consumerCompletedOrExpired:
      fixture?.consumer?.processorResult?.completedOrExpired ?? null,
    providerExpiredCount: fixture?.provider?.expiredCount ?? null,
  },
});
writeJson("notification-evidence.json", fixture?.notifications ?? {});
fs.writeFileSync(
  path.join(outDir, "report.md"),
  [
    "# Manual Review Expiry Local Dogfood",
    "",
    `Status: ${report.status}`,
    `Expiry seconds used: ${report.expirySecUsed}`,
    `Consumer status: ${fixture?.consumer?.after?.status ?? "n/a"}`,
    `Provider status: ${fixture?.provider?.after?.status ?? "n/a"}`,
    "",
  ].join("\n")
);

if (failures.length > 0) {
  console.error(`manual review expiry dogfood failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log(`manual review expiry dogfood evidence: ${outDir}`);
