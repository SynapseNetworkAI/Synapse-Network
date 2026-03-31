# Agent Workspace + Credits IA and Wireframe

> Status: proposed next-slice design
>
> Scope: Owner Control Plane / Agent Workspace / Treasury Credits
>
> Companion docs:
>
> 1. `docs/01_Product_Frontend/owner_agent_guide/agents_guide.md`
> 2. `docs/01_Product_Frontend/README.md`
> 3. `docs/Design.md`

## 1. Product Decision

Yes, a `Credits` sub-surface should exist.

But it should **not** float as a billing clone copied from X API.

Synapse needs a two-layer money model:

1. `Treasury Balance`
   - answers: `How much money does the owner control?`
2. `Agent Credits`
   - answers: `How much runtime budget can an agent actually spend right now?`

If these two are mixed into one number, users will ask the wrong question:

`Why does my wallet have USDC but my agent still cannot invoke paid services?`

## 2. Core UX Goal

When the user enters Agent Workspace, the page should feel like a clean app manager:

`Agents -> open detail -> manage API keys and runtime limits`

This surface should no longer behave like a setup checklist or a dense registry backend.
It should behave like a simple two-panel operating console.

## 3. Information Architecture

### 3.1 Owner navigation

Recommended owner-side IA:

1. `Overview`
2. `Agents`
3. `Discovery`
4. `Invocations`
5. `Treasury`
6. `Risk & Audit`
7. `Developer Resources`

### 3.2 Treasury sub-navigation

Recommended Treasury sub-menu:

1. `Balance`
2. `Credits`
3. `Transactions`

Why:

1. `Balance` is the money source
2. `Credits` is the runtime allocation surface
3. `Transactions` is the ledger truth

### 3.3 Agent sub-navigation

Recommended Agents sub-menu:

1. `Agent Workspace`
2. `Credentials`

`Credits` should not live under Agents as the canonical truth source.
It should be controlled under Treasury, then surfaced back into Agent Workspace as actions and health state.

## 4. Mental Model

The product needs to visually separate these 4 objects:

1. `Wallet`
2. `Treasury`
3. `Agent Credit Allocation`
4. `Invocation Spend`

This gives users a clean map:

`Wallet` -> `Treasury` -> `Credits` -> `Invocations`

## 5. Agent Workspace Structure

### 5.1 Header

The header should stay minimal:

1. `Agents`
2. helper copy: `Manage agents and API keys`

No setup rail.
No activation strip.
No status summary cards.

### 5.2 Left panel

The left panel should be a simple agent list.

Header:

1. `Your Agents`
2. `Create Agent +`
3. `Manage`

Each card should show:

1. agent name
2. short description
3. runtime status
4. credential prefix or short id

Do not add:

1. search
2. status filter
3. top KPI cards

### 5.3 Right panel

The right panel is the detail surface for the selected agent.

It should show:

1. agent title
2. brief description
3. credential card
4. quota / runtime limits card
5. metadata card

Primary actions:

1. `Regenerate Credential`
2. `Edit`
3. `Revoke`

`Regenerate Credential` is the user-facing version of rotating the runtime secret.

## 6. Agent Workspace Wireframe

```text
+--------------------------------------------------------------------------------------------------+
| Agents                                                                                           |
| Manage agents and API keys                                                                       |
+--------------------------------------------------------------------------------------------------+
| Your Agents                                      | Agent Detail                                  |
| [Create Agent +]                     [Manage]    |----------------------------------------------|
|--------------------------------------------------| buyer-agent-01                               |
| [buyer-agent-01                    ACTIVE ]      | Manage API keys and authentication            |
| Owner-bound runtime profile                      |                                               |
| prefix: agt_8e90de                               | [Regenerate Credential] [Revoke]              |
|                                                  |                                               |
| [research-agent-02                 REVOKED]      | Credential Prefix                             |
| Owner-bound runtime profile                      | agt_xxx...                                    |
| prefix: agt_5521af                               |                                               |
|                                                  | Runtime Limits                                |
| [ops-agent-03                      ACTIVE ]      | budget / usage / rate limit / remaining       |
| Owner-bound runtime profile                      | [Edit]                                        |
| prefix: agt_74bb0a                               |                                               |
|                                                  | Runtime Metadata                              |
|                                                  | owner / updated / status                      |
+--------------------------------------------------------------------------------------------------+
```

## 7. Credits Page Structure

The Credits page should feel like a runtime budget manager, not a generic billing page.

### 7.1 Top metrics

1. `Treasury Available`
2. `Allocated to Agents`
3. `Unallocated Credits`
4. `This Cycle Spend`

### 7.2 Primary actions

1. `Deposit / Top up`
2. `Allocate Credits`
3. `Rebalance`
4. `Set Spend Guardrail`

### 7.3 Core tables

Table 1: `Agent Credit Allocation`

Columns:

1. Agent
2. Allocated
3. Used
4. Remaining
5. Burn Rate
6. Status
7. Adjust

Table 2: `Credit Ledger`

Columns:

1. Time
2. Type
3. Amount
4. Source
5. Agent
6. Reference

## 8. Credits Page Wireframe

```text
+--------------------------------------------------------------------------------------------------+
| Credits                                                                                          |
| Manage runtime spending power for owner-funded agents                                             |
+--------------------------------------------------------------------------------------------------+
| [Treasury Available] [Allocated to Agents] [Unallocated] [This Cycle Spend]                     |
|                                                 [Deposit] [Allocate Credits] [Set Guardrail]    |
+--------------------------------------------------------------------------------------------------+
| Allocation Manager                                                                                |
|--------------------------------------------------------------------------------------------------|
| Agent        Allocated    Used      Remaining    Burn Rate      Status          Action           |
| buyer-01     $10.00       $1.40     $8.60        low            HEALTHY         Adjust           |
| ops-01       $25.00       $24.20    $0.80        high           NEEDS ATTN      Top Up           |
+--------------------------------------------------------------------------------------------------+
| Credit Ledger                                                                                     |
|--------------------------------------------------------------------------------------------------|
| Time            Type          Amount      Source          Agent         Reference                |
| 08:10           Allocation    $10.00      Treasury        buyer-01      alloc_...               |
| 08:14           Invocation     $0.03      Service Spend   buyer-01      inv_...                 |
| 08:20           Rebalance      $5.00      Credit Move     ops-01        alloc_...               |
+--------------------------------------------------------------------------------------------------+
```

## 9. Empty / Partial / Active States

### 9.1 Empty state

Condition:

1. no treasury funds
2. no agents

Hero copy:

`Fund your treasury to activate the first agent.`

CTA:

1. `Deposit USDC`
2. secondary: `How credits work`

### 9.2 Partial state A

Condition:

1. treasury funded
2. no agents

Hero copy:

`You have funds. Create a runtime identity next.`

CTA:

1. `Create Agent`

### 9.3 Partial state B

Condition:

1. agent exists
2. zero credit allocation

Hero copy:

`Your agent exists but cannot spend yet. Allocate credits to activate it.`

CTA:

1. `Allocate Credits`

### 9.4 Partial state C

Condition:

1. credits allocated
2. credential missing

Hero copy:

`Issue a credential so the runtime can authenticate and buy services.`

CTA:

1. `Issue Credential`

### 9.5 Active state

Condition:

1. funded
2. allocated
3. credentialed
4. at least one successful invocation

Hero copy:

`Your agent is live. Monitor spend, credits, and runtime health here.`

CTA:

1. `Run Invocation`
2. `Allocate Credits`

## 10. Recommended Component Model

Suggested UI modules:

1. `WorkspaceStatusStrip`
2. `WorkspaceSetupRail`
3. `WorkspaceStatePanel`
4. `AgentRegistryTable`
5. `CreditsOverviewCards`
6. `CreditAllocationTable`
7. `CreditLedgerTable`
8. `AllocateCreditsModal`
9. `DepositCreditsCta`

## 11. CTA Language

Use plain language, not infra jargon.

Preferred:

1. `Deposit USDC`
2. `Allocate Credits`
3. `Create Agent`
4. `Issue Credential`
5. `Run First Invocation`

Avoid as top-level CTA copy:

1. `Provision Runtime Budget`
2. `Issue Spend Envelope`
3. `Mint Access Capability`

## 12. Why This Beats a Direct X API Clone

X API Credits is mainly:

1. prepaid balance
2. usage cap
3. billing cycle

Synapse is different because credits are not only billing objects.
They are also runtime authorization objects.

So Synapse must additionally show:

1. treasury source of truth
2. agent-level budget allocation
3. credential readiness
4. invocation readiness

That is why the correct pattern is:

`X-like financial density` + `agent activation guidance`

not a blind clone.

## 13. Final Recommendation

Ship this as two coordinated surfaces:

1. `Agent Workspace`
   - activation + runtime operations
2. `Treasury > Credits`
   - budget allocation + runtime spend management

The user should always be able to move between them with one click:

1. from Agent Workspace -> `Open Credits`
2. from Credits -> `Open Agent Workspace`
