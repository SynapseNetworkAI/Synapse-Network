import type { I18nMessages } from "@/i18n/schema";

const en: I18nMessages = {
  language: {
    en: "English",
    zh: "Chinese",
  },
  nav: {
    apiMarketplace: "API Marketplace",
    blog: "Blog",
    about: "About",
    gatewayNode: "Gateway Node",
    online: "Online",
    offline: "Offline",
    checking: "Checking...",
  },
  home: {
    heroTitle: "The Settlement Layer for AI Agents",
    heroSubtitle:
      "The API settlement gateway for AI agents (Stripe for AI Agents). Enable machines to buy and sell API services with zero gas per call and millisecond settlement.",
    heroTagline: "Agents can talk. But now, they can trade.",
    buyerBtn: "Buyer Access",
    providerBtn: "Provider Console",
    providerTitle: "For Providers",
    providerHeadline: "Write once. Earn globally.",
    providerBody:
      "Register your API, set per-call pricing, and receive USDC revenue every time agents invoke your service.",
    consumerTitle: "For Consumers",
    consumerHeadline: "One API key, network-wide intelligence.",
    consumerBody:
      "Top up USDC collateral once, then let your agents call multiple services with pay-per-call billing and unified settlement.",
    explore: "Explore",
    islandTitle: "Every agent is an island. Until now.",
    islandBody:
      "Synapse upgrades AI from API callers into API traders, turning interactions into verifiable settlement flows.",
    problemTitle: "The Problem",
    solutionTitle: "The Solution",
    problemItems: [
      "Agents can reason and execute code, but they still cannot pay natively.",
      "Micro-transactions break in machine-to-machine flows and fall back to human billing.",
      "On-chain per-call payments are too slow and too expensive for high-frequency traffic.",
    ],
    solutionItems: [
      "Give agents native spending and earning capability with auditable payment rails.",
      "Use off-chain gateway charging for millisecond-level high-frequency calls.",
      "Settle against on-chain USDC collateral with near-zero marginal gas per call.",
    ],
    safetyTitle: "Collateralized Security",
    safetyBody:
      "Buyer funds are deposited into on-chain vaults first. Settlement is always backed by verifiable contract rules.",
    speedTitle: "High-Frequency Settlement",
    speedBody:
      "Charging is executed off-chain at the gateway, so agents can run burst traffic without per-call chain friction.",
    transparencyTitle: "Transparent Economics",
    transparencyBody:
      "Each invocation exposes fee splits, provider revenue, and remaining balance with audit-ready trails.",
    registryTitle: "Registered Services",
    registryBody:
      "Live service inventory for users and agents. Discover available service IDs, pricing, and endpoints before invoking.",
    registryEmpty: "No registered services yet. Publish one from Provider Console to appear here.",
    loadingServices: "Loading service registry...",
    startBuilding: "Start Building",
    finalLine: "Synapse is not a chatbot plugin. It is the settlement rail for the machine economy.",
    serviceIdLabel: "serviceId",
  },
  blogPage: {
    title: "Blog",
    description: "Product updates, architecture notes, and launch logs for Synapse Network will be published here.",
  },
  aboutPage: {
    title: "About Synapse Network",
    description:
      "Synapse Network is the settlement infrastructure for AI agents: on-chain USDC collateral, off-chain millisecond charging, and audit-ready machine-to-machine commerce.",
  },
};

export default en;
