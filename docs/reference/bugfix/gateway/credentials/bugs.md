# Bug Report: Credentials (Agent Credentials)

**Page:** Agent Credentials (`/dashboard/credentials`)  
**Date:** 2026-04-07  
**Test Status:** PASS ✅

No bugs found. Page loads correctly with:
- "Agent Credentials" heading and description
- "+ Issue Credential" button
- "Connect Wallet" modal overlay (expected — requires wallet authentication)
- Background form/table visible behind overlay

The connect wallet gate is correct behavior. Once authenticated, the full credential issuance form and credentials table become accessible.

![Credentials screenshot](../../test/gateway/screenshots/credentials.png)
