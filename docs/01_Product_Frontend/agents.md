# Agents Frontend Design & Implementation

> **Status**: Implemented (v1.0)  
> **Path**: `apps/frontend/src/app/dashboard/agents/page.tsx`  
> **Identity Context**: Owner Control Plane - Agent Workspace

## 1. Overview

The Agents page is the primary interface for the **Owner** to manage their **Agent Profiles**. In the Synapse Identity Model, an Agent is a runtime identity authorized by the Owner to discover and invoke services within defined budget constraints.

## 2. Core Functionalities

### 2.1 Agent Profile Management
- **List Agents**: Displays all active and revoked agent credentials associated with the Owner's wallet.
- **Create Agent**: A guided workflow to issue new credentials with specific metadata (Name) and initial policies.
- **Revoke Agent**: Immediate invalidation of an agent's credential, cutting off all future service access.

### 2.2 Budget & Quota Enforcement
- **Daily Budget**: Real-time display of the USDC credit limit assigned to each agent.
- **Call Quota**: Visual progress bar showing `callsUsed` vs `maxCalls`.
- **Reset Intervals**: Support for daily/weekly/monthly budget resets (V1 defaults to Daily).

### 2.3 Credential Security
- **One-time Token Display**: Upon creation, the full `Agent Token` is shown once. The UI enforces a "I've Saved the Token" confirmation.
- **Token Masking**: Existing credentials only show a `tokenPrefix` for identification, never the full secret.

## 3. Technical Implementation

### 3.1 Backend Integration (API)
The page interacts with the `agentCredentialApi.ts` utility, which calls the following Gateway endpoints:
- `GET /api/v1/credentials/agent/list`: Retrieves the list of agent profiles.
- `POST /api/v1/credentials/agent/issue`: Creates a new profile and returns the secret token.
- `POST /api/v1/credentials/agent/{id}/revoke`: Revokes an existing credential.

### 3.2 State Management
- **React Hooks**: Uses `useState` for modal toggles and form inputs, `useEffect` for initial data fetching.
- **Wagmi & Auth**: Integrates with `useAccount` and `useAuth` to ensure only authenticated owners can manage their agents.

### 3.3 UI Components
- **Lucide Icons**: Uses `Bot`, `Key`, `ShieldCheck`, and `Zap` to maintain a professional, technical aesthetic.
- **Tailwind CSS**: Implements a dark-mode "Control Plane" style with emerald (success), blue (action), and amber (warning) accents.

## 4. User Experience (UX) Principles

1. **Safety First**: Revocation requires explicit confirmation. Tokens are only shown once.
2. **Transparency**: Clear visualization of budget consumption prevents "bill shock" for the Owner.
3. **Efficiency**: Quick-copy buttons for Agent IDs and Tokens to facilitate easy integration into agent codebases.

## 5. Future Roadmap (V2)
- **Shared Budget Pools**: Allowing multiple agents to draw from a single USDC allocation.
- **Granular Permissions**: Restricting agents to specific service categories or providers.
- **Real-time Usage Graphs**: Detailed time-series data for agent consumption patterns.
