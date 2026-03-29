## Agents Frontend Design Documentation

### 1. Overview

This document outlines the design and implementation of the Agents page within the Synapse Network dashboard. The primary goal of this page is to provide a clear, guided onboarding experience for Owners to fund their vault, create agent credentials, and understand how to initiate service invocations. It follows the "Activation Runway" model to simplify the user journey.

### 2. Key Features

#### 2.1 Activation Status Strip

-   **Purpose**: Provides a high-level overview of the Owner's readiness for the first paid agent call.
-   **Metrics Displayed**:
    -   **Wallet Connection Status**: Indicates if the user's wallet is connected.
    -   **Session Status**: Shows if an authenticated session is active.
    -   **Platform Balance**: Displays the current spendable balance in USDC within the Synapse platform (not the wallet balance).
    -   **Active Agents**: Number of active agent credentials created by the Owner.
    -   **Last Invocation**: Status of the most recent agent invocation.
-   **Design**: Uses a clean, dark-themed card layout with clear icons and status indicators.

#### 2.2 Activation Runway

-   **Purpose**: Guides the Owner through the essential steps to enable agent functionality, from funding to the first invocation.
-   **Steps**:
    1.  **Fund Owner Vault**:
        -   **Description**: Explains the necessity of moving USDC from the wallet into the Synapse credit system for runtime settlement.
        -   **Action**: "Deposit USDC" button, which triggers a session authentication check and then opens the Deposit USDC modal.
        -   **Tooltip**: Provides detailed explanation on why funds need to be moved to the vault.
    2.  **Create Agent Runtime**:
        -   **Description**: Guides the Owner to issue a runtime identity with budget and call guards.
        -   **Action**: "Create Agent" button, leading to the agent creation flow.
        -   **Tooltip**: Explains what an Agent is and its role as a runtime identity.
    3.  **Capture Credential**:
        -   **Description**: Instructs the Owner to securely store the one-time secret (credential) for agent access.
        -   **Action**: "Issue Credential" button, which generates and displays the credential once.
        -   **Tooltip**: Emphasizes the one-time visibility and importance of secure storage.
    4.  **Run First Paid Invocation**:
        -   **Description**: Explains how to use the credential for service discovery, payment settlement, and verifying gateway responses.
        -   **Action**: "Run Example" button, linking to a guide or example invocation.
        -   **Tooltip**: Provides context on the invocation process.
-   **Design**: Each step is presented as a distinct card with a status (Blocked, Locked, Ready) and a clear call-to-action. Tooltips are integrated for complex concepts.

#### 2.3 Agent Management Table

-   **Purpose**: Displays a list of all active agent credentials, their associated budgets, and usage statistics.
-   **Columns**:
    -   Agent ID (truncated for security)
    -   Daily Budget (USDC)
    -   Lifetime Budget (USDC)
    -   Calls Used / Max Calls
    -   Status (Active, Paused, etc.)
    -   Actions (Revoke, Edit Budget)
-   **Design**: A sortable, paginated table with clear visual indicators for budget usage and status.

### 3. Technical Implementation Details

-   **Frontend Framework**: Next.js (React) with TypeScript.
-   **Styling**: Tailwind CSS for utility-first styling, ensuring consistency with the overall dark theme.
-   **Semantic HTML**: Utilizes semantic HTML5 elements (`<section>`, `<article>`, `<header>`, `<dl>`, `<dt>`, `<dd>`) instead of generic `<div>` elements for improved accessibility and structure.
-   **State Management**: React `useState` and `useEffect` hooks for managing UI state, such as modal visibility and quick start guide progression.
-   **API Integration**: Interacts with the Synapse Gateway API for:
    -   Fetching Owner balance and agent data.
    -   Registering deposit intents (`/api/v1/balance/deposit/intent`).
    -   Creating and revoking agent credentials.
-   **Authentication**: Integrates with `useAuth` and `useConnectModal` to ensure users are authenticated before performing sensitive actions like depositing funds.
-   **Deposit Flow**: Leverages the `DepositUsdcModal` component, which implements the EIP-2612 Permit flow for single-transaction USDC deposits.
-   **Error Handling**: Displays user-friendly error messages for API failures or invalid inputs.

### 4. User Experience (UX) Principles

-   **Clarity**: All UI elements and descriptions are designed to be clear and unambiguous, guiding the user through complex financial and technical processes.
-   **Guidance**: The "Activation Runway" and tooltips provide proactive guidance, reducing the need for external documentation.
-   **Feedback**: Real-time updates on balances, agent status, and invocation results provide immediate feedback to the user.
-   **Security**: Sensitive information, such as full agent tokens, is handled securely (displayed only once upon creation).
-   **Consistency**: Maintains a consistent visual language and interaction patterns with the rest of the Synapse dashboard.

### 5. Future Enhancements

-   Integration of real-time event streaming for deposit confirmations and invocation results.
-   Advanced analytics and reporting for agent usage and spending patterns.
-   More interactive tutorials for service discovery and invocation examples.
