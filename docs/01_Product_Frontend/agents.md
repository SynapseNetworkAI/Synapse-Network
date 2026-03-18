# Agents Frontend Design & Implementation

> **Status**: Implemented (v2.0 - With Onboarding)  
> **Path**: `apps/frontend/src/app/dashboard/agents/page.tsx`  
> **Components**: `QuickStartGuide.tsx`, `OverviewHero.tsx`, `RolePathCards.tsx`  
> **Identity Context**: Owner Control Plane - Agent Workspace

## 1. Overview

The Agents page is the primary interface for the **Owner** to manage their **Agent Profiles**. In the Synapse Identity Model, an Agent is a runtime identity authorized by the Owner to discover and invoke services within defined budget constraints.

The page now includes a **guided onboarding experience** that leads new users through the three critical steps of the Synapse conversion funnel:
1. **Deposit USDC** to the Vault
2. **Create Agent Credential** with budget policies
3. **Discover & Access Services** in the marketplace

## 2. Core Functionalities

### 2.1 Quick Start Onboarding (New in v2.0)

When a user first visits the Agents page without any credentials, they see a **4-step progress guide**:

- **Step 1: Deposit USDC**
  - Integrated deposit modal with EIP-2612 Permit flow
  - Real-time wallet balance display
  - Transaction confirmation with on-chain verification
  - Automatic balance polling after deposit

- **Step 2: Create Agent**
  - Pre-filled form with sensible defaults (10 USDC daily budget, 1000 max calls)
  - Clear explanation of what an agent is
  - One-click creation after deposit

- **Step 3: Discover Services**
  - Preview of available services in the marketplace
  - Visual representation of pricing and capabilities
  - Direct link to service discovery

- **Step 4: Complete Setup**
  - Success confirmation
  - Quick links to view agents and browse marketplace

### 2.2 Agent Profile Management

- **List Agents**: Displays all active and revoked agent credentials associated with the Owner's wallet.
- **Create Agent**: A guided workflow to issue new credentials with specific metadata (Name) and initial policies.
- **Revoke Agent**: Immediate invalidation of an agent's credential, cutting off all future service access.

### 2.3 Budget & Quota Enforcement

- **Daily Budget**: Real-time display of the USDC credit limit assigned to each agent.
- **Call Quota**: Visual progress bar showing `callsUsed` vs `maxCalls`.
- **Reset Intervals**: Support for daily/weekly/monthly budget resets (V1 defaults to Daily).

### 2.4 Credential Security

- **One-time Token Display**: Upon creation, the full `Agent Token` is shown once. The UI enforces a "I've Saved the Token" confirmation.
- **Token Masking**: Existing credentials only show a `tokenPrefix` for identification, never the full secret.

## 3. Technical Implementation

### 3.1 Deposit Flow (QuickStartGuide Component)

The deposit functionality is extracted from the Developer Console and integrated directly into the Agents page:

```typescript
// Key features:
- EIP-2612 Permit signature (no gas required for approval)
- Automatic nonce management
- Transaction retry logic with exponential backoff
- Real-time balance polling after confirmation
- Error handling with user-friendly messages
```

**API Integration**:
- `createDepositIntent()`: Registers the deposit with the backend
- `recordDepositAttempt()`: Tracks deposit stages for analytics

### 3.2 State Management

- **React Hooks**: Uses `useState` for modal toggles and form inputs, `useEffect` for initial data fetching and quick start detection.
- **Wagmi & Auth**: Integrates with `useAccount` and `useAuth` to ensure only authenticated owners can manage their agents.
- **Progress Tracking**: The `currentStep` state tracks the user's position in the onboarding flow.

### 3.3 UI Components

- **Lucide Icons**: Uses `Zap`, `Lock`, `Rocket`, and `CheckCircle2` to represent each onboarding step.
- **Tailwind CSS**: Implements a dark-mode "Control Plane" style with blue (action), emerald (success), and amber (warning) accents.
- **Progress Stepper**: Visual representation of the 4-step funnel with clickable navigation.

## 4. User Experience (UX) Principles

1. **Conversion Funnel Optimization**: The page detects when a user has no agents and automatically shows the onboarding guide, ensuring they don't get stuck.
2. **Safety First**: Revocation requires explicit confirmation. Tokens are only shown once.
3. **Transparency**: Clear visualization of budget consumption prevents "bill shock" for the Owner.
4. **Efficiency**: Quick-copy buttons for Agent IDs and Tokens to facilitate easy integration into agent codebases.
5. **Guided Progression**: Each step is clearly labeled with icons and descriptions, reducing cognitive load.

## 5. Conversion Metrics

The onboarding flow tracks these critical metrics:

| Metric | Purpose |
|--------|---------|
| `Owner deposited USDC` | Primary conversion indicator |
| `Owner created Agent credential` | Secondary conversion indicator |
| `Agent discovered services` | Engagement indicator |
| `Agent invoked API` | Monetization indicator |

## 6. Future Roadmap (V3)

- **Shared Budget Pools**: Allowing multiple agents to draw from a single USDC allocation.
- **Granular Permissions**: Restricting agents to specific service categories or providers.
- **Real-time Usage Graphs**: Detailed time-series data for agent consumption patterns.
- **Template Agents**: Pre-configured agent profiles for common use cases (e.g., "Data Aggregator", "ML Inference Runner").
- **Invite-based Onboarding**: Allow existing users to invite new users and share budget pools.
