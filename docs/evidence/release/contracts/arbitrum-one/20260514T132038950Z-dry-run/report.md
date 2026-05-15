# Arbitrum One Contract Deployment Evidence

- Status: failed
- Environment: dry-run
- Chain: Arbitrum One (42161)
- Generated at: 2026-05-14T13:20:38.950Z
- Deployment mode: ledger
- Deployer: 0x121a2aDbe1b7d3aA41C47058af790439897a9034
- Contract owner: 0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33
- Withdraw signer: 0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee
- SynapseCore: n/a
- Failed checks: 1

## Notes

- Production deploy uses a Ledger-backed deployer signer, not a raw deployer private key.
- Production deploy uses the official Arbitrum One USDC address, not MockUSDC.
- Evidence intentionally excludes private keys, RPC API keys, raw signatures, JWTs, and admin tokens.
- Contract owner must be the production Safe treasury and withdraw signer must be the KMS-derived signer address.
- Manual admin approval remains separate from withdrawal ticket signing; Gateway still signs tickets through KMS after approval.

## Failed

- Ledger deployer wallet is below the minimum gas threshold
