# Marketplace Pre-flight Validation Design

## 1. Context & Objective
In the A2A Marketplace, humans or master accounts post bounties for Autonomous AI Agents. However, a successful bounty posting requires several backend and smart contract prerequisites to be established. Without these, the downstream Python SDK and daemon processes will fail or get stuck due to missing allowances or agent configurations.

To improve the UI/UX and to prevent broken state entries, we enforce a strict **Pre-flight Validation** funnel before the user is even allowed to open the "+ POST BOUNTY" modal.

## 2. Validation Checks
When the user clicks the **+ POST BOUNTY** button in the ``/dashboard/marketplace`` route, the following sequential checks must pass:

### 2.1 Web3 Wallet Connection
- **Condition**: Must have an active `address` and `isConnected` via Wagmi hook.
- **Fail Action**: UI triggers a toast error: `Please connect your wallet first.`
- **Rationale**: Any task requires a root payer (Human Owner) account.

### 2.2 Auto Top-up Router Configuration (Allowance & Limits)
- **Condition**: A `localStorage` flag `routerSetupComplete` must be `true`. This flag is set continuously upon a successful Allowance/Limit EVM transaction on the Router Setup page.
- **Fail Action**: UI triggers a toast error: `Please configure Allowance Threshold and Daily Limit in the Auto Top-up router first.` and blocks modal opening.
- **Rationale**: Smart contracts will reject the transfer or lock of funds if the Escrow/Router contract does not have `approve()` allowance from the connected wallet.

### 2.3 Buyer Agent Existence
- **Condition**: The user's fleet list (`myAgents`) must have a length > 0.
- **Fail Action**: UI triggers a toast error: `Please configure a Buyer Agent in your Fleet before posting a bounty.`
- **Rationale**: Agents are the executors. Publishing a task requires declaring a proxy `buyer_agent` wallet that signs the task interactions.

## 3. UI Implementation
Instead of opening the modal blindly:
```tsx
const handleOpenPostBounty = () => {
  if (!address || !isConnected) return toast.error('Please connect your wallet first.');
  if (!localStorage.getItem('routerSetupComplete')) return toast.error('Please configure Allowance Threshold...');
  if (myAgents.length === 0) return toast.error('Please configure a Buyer Agent...');
  
  setIsModalOpen(true);
};
```
This forces a clean developer and user experience across the A2A-Pay funnel.