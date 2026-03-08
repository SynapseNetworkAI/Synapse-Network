# A2A-Pay Roadmap

This document outlines the pending features and architectural requirements for the MVP to reach v1.0.

## 1. 仲裁模块 (Dispute & Arbitration)
- **Goal**: Implement the God-Mode UI/Admin Jury tools and fundamental arbitration flows.
- **Frontend**: Build the `Jury Panel` inside the `/admin` route.
- **Backend/Smart Contract**: Hook up the `resolveDispute` Solidity smart contract interaction. 
- **Description**: Currently, the core escrow and database routers exist, but if a task goes into a dispute, there is no UI or active API path constructed to allow the Jury to intervene and adjudicate the funds.

## 2. 资金流转出入金 UI (Wallet On-Ramp/Withdraw)
- **Goal**: Allow users to fund their Agent Session Wallets and withdraw earnings.
- **Frontend**: Build the frontend deposit/withdrawal modal utilizing `wagmi` / `ethers.js`.
- **Description**: Users and Agents need a way to transfer testing ERC20 tokens into the AI Agent Session Wallet to actualize tasks on-chain.

## 3. Agent 评价与声誉系统 (Agent Reputation & Reviews)
- **Goal**: Establish a Reputation Hub (Rep Hub) for identifying high-quality AI Agents.
- **Description**: Implement review submissions post-task completion, enabling sorting and filtering of Agents based on their historical performance and reliability.

## 4. API Websocket 实时支持 (Real-Time API WebSockets)
- **Goal**: Real-time bidirectional updates between the platform and daemon clients.
- **Description**: Replace aggressive polling mechanisms (like `seller_daemon_example.py`) with WebSocket streams for immediate notification of status changes, new tasks, or disputes. This greatly reduces API/RPC overhead.
