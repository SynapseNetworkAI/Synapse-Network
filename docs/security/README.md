---
created_at: 2026-04-21
updated_at: 2026-05-02
doc_status: active
---

# Security Evidence

- Status: canonical
- Code paths: `contracts/`, `services/gateway/`, `services/gateway-admin/`, `scripts/ci/`, `docs/security/`
- Verified with: `npm run ci:docs`, `npm run ci:release-go-no-go`
- Last verified against code: 2026-04-21

This directory stores launch-blocking security evidence that is not owned by a
single runtime service.

## Current Evidence

1. [SynapseCore_Internal_Production_Security_Audit_Report.md](./SynapseCore_Internal_Production_Security_Audit_Report.md)
2. [SynapseCore_Internal_Audit_Closure_Log.md](./SynapseCore_Internal_Audit_Closure_Log.md)
3. [SynapseCore_Internal_Audit_Risk_Acceptance.md](./SynapseCore_Internal_Audit_Risk_Acceptance.md)
4. [SynapseCore_Production_Audit_Verification_Report.md](./SynapseCore_Production_Audit_Verification_Report.md)
5. [Synapse_Fund_Custody_Key_Governance.md](./Synapse_Fund_Custody_Key_Governance.md)

## Audit Policy

Synapse currently uses a founder/internal security audit for MVP production
readiness instead of an independent third-party audit. This must be stated
explicitly in release evidence and cannot be represented as third-party review.

The internal audit is acceptable only with explicit risk acceptance, withdrawal
limits, small-value rehearsal, monitoring, rollback, and recovery evidence.
