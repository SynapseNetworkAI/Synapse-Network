# Security Policy

Synapse Network includes payment, wallet, settlement, and privileged admin
surfaces. Please report vulnerabilities responsibly and avoid public disclosure
until a fix or mitigation is available.

## Supported Versions

The public `main` branch is the active development line during public preview.
Tagged releases will define support windows after the first stable release.

## Reporting A Vulnerability

Please do not open a public GitHub issue for a suspected vulnerability.

Report security issues by email:

- `security@synapse-network.ai`

Include:

- affected component or path
- reproduction steps
- impact assessment
- whether credentials, funds, user data, or admin privileges are involved
- any logs or screenshots with secrets redacted

## Scope

High-priority areas:

- smart contracts and withdrawal settlement
- Gateway billing, receipts, ledger, idempotency, and provider routing
- agent credentials and owner authentication
- admin RBAC, approvals, MFA, audit, and finance review
- secret handling, deployment configuration, and CI/CD credentials

## Secret Handling

Do not include private keys, wallet mnemonics, access tokens, database DSNs,
OAuth secrets, service-account JSON, cookies, or bearer tokens in reports,
screenshots, pull requests, or issues. Redact those values and describe their
type and source instead.
