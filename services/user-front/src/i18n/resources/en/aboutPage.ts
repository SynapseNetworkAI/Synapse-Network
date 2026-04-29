import type { I18nMessages } from "@/i18n/schema";

const aboutPage: I18nMessages["aboutPage"] = {
  eyebrow: "About SynapseNetwork",
  title: "The settlement layer for the agent economy.",
  description:
    "Collateral on-chain. Usage off-chain. Settlement with receipts.",
  primaryCta: "Explore marketplace",
  secondaryCta: "Read the docs",
  xCta: "Follow on X",
  heroFeatureCards: [
    "0 gas per API call|Sub-cent, high-frequency agent-to-agent payments.",
    "USDC-native reconciliation|Cryptographic receipts. Audit-ready by design.",
    "Provider revenue without custom billing stacks|Plug in. Get paid. Scale globally.",
  ],
  agentRailLabel: "AI Agents",
  providerRailLabel: "Services & Providers",
  collateralLabel: "USDC Collateral",
  collateralDescription: "On-chain escrow",
  auditLabel: "Audit-ready receipts",
  auditChecks: [
    "Tamper-proof logs",
    "Verifiable usage",
    "Deterministic settlement",
  ],
  providerTypes: [
    "LLM Provider|Model inference",
    "Data Provider|Real-time APIs",
    "Tool Provider|Functions & tools",
  ],
  heroSignal: "Agent commerce is becoming machine-speed.",
  heroSignalDetail:
    "Payments need to be just as fast, programmable, and reconcilable.",
  protocolLabel: "How it works",
  protocolTitle:
    "Collateral on-chain. Usage off-chain. Settlement with receipts.",
  protocolDescription:
    "The network keeps expensive blockchain actions at the edges while every API call remains priced, metered, and traceable.",
  protocolSteps: [
    "Consumers deposit USDC into the vault.",
    "Agents call providers through Gateway credentials.",
    "Synapse meters usage, debits balances, and credits providers in milliseconds.",
    "Providers withdraw with signed tickets and on-chain finality.",
  ],
  thesisLabel: "Infrastructure thesis",
  thesisTitle:
    "AI agents need a payment rail built for tiny, frequent, verifiable work.",
  thesisDescription:
    "Credit cards and manual invoicing were built for humans. Smart contracts alone are too slow and expensive for every micro-call. SynapseNetwork joins both worlds without making builders choose.",
  thesisItems: [
    "0 gas per API call for agents",
    "USDC-native balances and reconciliation",
    "Provider revenue without custom billing stacks",
    "Audit trails for finance, security, and operations",
  ],
  commitmentsLabel: "What we protect",
  commitmentsTitle: "The network is designed around money safety first.",
  commitments: [
    "No hidden balance mutations without ledger entries.",
    "No provider payout without a signed withdrawal path.",
    "No production release without evidence, monitoring, and rollback records.",
  ],
  proofLabel: "Where we are going",
  proofTitle: "From API marketplace to machine-to-machine economy.",
  proofPoints: [
    "API providers can publish services agents discover and invoke.",
    "LLM providers can expose token-metered model endpoints.",
    "Operators can reconcile deposits, refunds, withdrawals, and fees from one control plane.",
  ],
  finalTitle: "Build where agents can pay each other.",
  finalDescription:
    "SynapseNetwork is the payment and settlement substrate for autonomous software that buys work, earns revenue, and proves what happened.",
  missionLabel: "Our mission",
  missionBody:
    "To become the global settlement layer for AI agents, unlocking a world where machines can transact freely, securely, and at scale.",
  values: [
    "Trust by design|Cryptography over convention.",
    "Performance first|Built for real-time, machine-scale usage.",
    "Open and composable|Interoperable rails for the ecosystem.",
    "Aligned incentives|Fair fees. Transparent settlement.",
  ],
};

export default aboutPage;
