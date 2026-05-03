---
created_at: 2026-05-02
updated_at: 2026-05-02
doc_status: active
---

# Synapse Fund Custody and Key Governance

- Status: canonical
- Code paths: `contracts/SynapseCore.sol`, `services/gateway/src/services/balance_mixins/`, `services/gateway-admin/`, `services/admin-front/`
- Verified with: `npm run ci:contracts`, `npm run ci:gateway`, `npm run ci:admin-gateway`, `npm run ci:docs`
- Last verified against code: 2026-05-02

Synapse has two separate money authorities. They must never collapse into one
hot wallet.

## Authority split

1. **Treasury owner key** controls `SynapseCore.owner`. It can call
   `withdrawPlatformFees()` and `setSigner()`. V1 uses a `1-of-1` Safe. Early
   local/staging operations may use MetaMask as the Safe owner; production
   should use Ledger as the Safe owner.
2. **Withdrawal signer key** controls `SynapseCore.platformSigner`. It only
   signs EIP-712 consumer/provider withdrawal tickets. Production should use
   Cloud KMS or AWS KMS secp256k1 signing, not a raw `0x...` private key.

`withdrawPlatformFees()` can only transfer accrued `platformFeePool` to the
contract owner/Safe. It cannot withdraw arbitrary user principal. User/provider
principal leaves the vault only through `withdraw(...)` with a valid
platform-signed ticket and the caller's own wallet transaction.

## Production signer policy

Gateway supports:

```text
WITHDRAW_SIGNER_MODE=local_private_key|gcp_kms|aws_kms
```

`local_private_key` is for local only after staging KMS migration evidence is
green. Staging and production release evidence must use `gcp_kms` or `aws_kms`.

Required production signer evidence:

1. KMS key resource id.
2. KMS-derived Ethereum signer address.
3. `SynapseCore.platformSigner()` equals the derived signer address.
4. Gateway service account has sign-only access to that one KMS key.
5. Gateway-admin, frontend, developer laptops, and CI do not have sign
   permission.
6. A signer rollback drill proves Safe can rotate to a new KMS signer.

KMS keys are environment-scoped. Prefer separate GCP projects for staging and
production; at minimum use different key rings / crypto keys:

- `synapse-staging-withdraw-signer`
- `synapse-prod-withdraw-signer`

The staging Gateway service account may sign only with the staging key. The
production Gateway service account may sign only with the production key. Never
reuse the same KMS key across staging and production with an environment prefix
in the request payload.

## Staging KMS migration inventory

Staging now rehearses the same signer boundary before production. The runtime
Gateway should use:

| Item            | Staging value                                               | Owner                  | Cleanup status                                                                |
| --------------- | ----------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| Signer mode     | `WITHDRAW_SIGNER_MODE=gcp_kms`                              | Gateway runtime config | Active                                                                        |
| KMS key ring    | `synapse-staging` in `us-central1`                          | Terraform              | Active                                                                        |
| KMS crypto key  | `synapse-staging-withdraw-signer`                           | Terraform              | Active                                                                        |
| KMS key version | `.../cryptoKeyVersions/1` unless rotated                    | Terraform / Cloud KMS  | Active                                                                        |
| Signer address  | Derived with `scripts/chain/gcp_kms_derive_eth_address.mjs` | Release evidence       | Must equal `SynapseCore.platformSigner()`                                     |
| Legacy secret   | `synapse-staging-private-key`                               | Secret Manager         | Delete only after KMS withdrawal E2E passes and Cloud Run has zero references |

The staging cleanup sequence is intentionally evidence-gated:

1. Run `bash scripts/deploy/gcp_audit_staging_security_config.sh <project-id>`.
2. Prove Cloud Run services/jobs no longer reference `PRIVATE_KEY` or
   `synapse-staging-private-key`.
3. Prove small-value withdrawal E2E succeeds with `gcp_kms`.
4. Set Terraform `legacy_withdraw_private_key_secret_enabled=false` and apply.
5. Run `scripts/deploy/gcp_cleanup_staging_security_config.sh` with the explicit
   destructive confirmation.

Cloud KMS key rings and crypto keys cannot be physically deleted. Retiring an
unused KMS signer means removing IAM and disabling or destroying explicit key
versions after they are no longer configured in Gateway or on-chain
`platformSigner()`.

## Treasury operation policy

Platform fee withdrawal is a treasury action:

1. Super admin creates a Safe transaction draft in Admin.
2. Backend fixes `to=SynapseCore`, `value=0`, and selector
   `withdrawPlatformFees(uint256)`.
3. Frontend cannot provide `to`, `data`, `recipient`, or function intent.
4. Safe UI executes the transaction; Ledger confirms it.
5. Admin records request id, calldata hash, chain tx hash, before/after
   `platformFeePool`, and Safe USDC delta.

## Emergency controls

If KMS usage spikes, withdrawal anomalies appear, or reconciliation drifts:

1. Disable ticket signing or block new withdrawal intents.
2. Create a new KMS secp256k1 key.
3. Derive and verify the Ethereum signer address.
4. Use Safe owner to call `SynapseCore.setSigner(newSigner)`.
5. Verify old signer tickets fail and new signer tickets succeed.
