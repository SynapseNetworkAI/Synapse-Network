# Agents Page Product Guide

> Status: Implemented v3 activation slice with status strip, activation runway, and first invocation panel  
> Path: `apps/frontend/src/app/dashboard/agents/page.tsx`  
> Current Components: `ActivationStatusStrip.tsx`, `ActivationRunway.tsx`, `FirstInvocationPanel.tsx`  
> Identity Context: Owner Control Plane / Agent Workspace

## 0. Canonical Status

This file is now the only maintained product guide for the Agents page.

`docs/01_Product_Frontend/AGENTS.md` has been retired and deleted because its historical design is no longer part of the active frontend direction.

The current funding path also changed:

1. `Deposit USDC` on Agents now reuses the same Vault Deposit flow as Owner Treasury
2. permit signing, transaction submission, receipt recovery, and deposit-intent retry are no longer maintained as a separate Agents-only implementation

## 1. Product Role

Agents page is not just a credential list page.

It is the Owner-side activation surface that must push the user from:

1. funded owner vault
2. created agent runtime
3. issued agent credential
4. first successful `discover -> quote -> invoke`

The success metric for this page is not `credential created`.

The true success metric is:

`Agent completed first paid invocation autonomously.`

## 2. Current Implemented State

The current production page already includes these implemented capabilities:

1. unauthenticated and authenticated users now see the same page structure
2. top-level `ActivationStatusStrip` explains wallet, session, spendable balance, active agents, last invocation, and next CTA
3. `ActivationRunway` makes fund -> create -> capture credential -> run invocation an explicit four-stage workflow
4. create agent flow validates wallet connection and session before issuing a credential
5. create modal shows bound owner address
6. newly issued credential is shown once and only once in a success modal
7. `FirstInvocationPanel` shows discovery / quote / invoke snippets plus a real paid sandbox invocation path
8. existing agents render as cards with budget, calls, usage bar, created date, copy token prefix, and revoke action

### 2.1 What the current page still does not solve well enough

The current page still under-communicates one critical thing:

**how the Owner turns a created credential into an actual agent runtime call against Synapse services.**

Right now the page helps users finish:

1. deposit
2. create agent
3. paste and persist the one-time credential for a selected service
4. run a real paid example against a discovered public service

But it does not yet fully solve:

1. recent invocation preview in the agent workspace layer
2. richer quote detail beyond catalog price preview
3. credential lifecycle rotation beyond one-time token capture
4. deeper workspace analytics after the first activation event

That is the gap v3 must close.

## 3. V3 Product Direction

Agents page should evolve from:

`credential management page`

into:

`activation runway + agent runtime workspace`

### 3.1 Top-level page structure

The page should be split into two layers:

1. Activation Runway
2. Agent Workspace

For the Credits extension, state model, and next-slice wireframe, see:

1. `docs/01_Product_Frontend/owner_agent_guide/agent_workspace_credits_ia_wireframe.md`

Activation Runway answers:

1. where the user is stuck
2. what the next best action is
3. how to run the first paid invocation

Agent Workspace answers:

1. which agents already exist
2. how they are performing
3. whether their credentials and budgets are healthy

## 4. Proposed Page Wireframe

```text
+----------------------------------------------------------------------------------+
| Agents Page                                                                      |
| Status Strip                                                                     |
| [Wallet] [Session] [Spendable Balance] [Active Agents] [Last Invocation] [CTA] |
+----------------------------------------------------------------------------------+
| Activation Runway                                                                |
| Step 1 Fund Vault | Step 2 Create Agent | Step 3 Issue Credential | Step 4 Run |
| Inline completion states, blockers, and next action                             |
+----------------------------------------------------------------------------------+
| First Invocation Panel                                                           |
| Tabs: TypeScript | Python | cURL                                                 |
| A. Discovery example                                                             |
| B. Quote example                                                                 |
| C. Invoke example                                                                |
| D. Run Example / Sandbox Invocation                                              |
| E. Output: quote price / invocation status / response / charged usdc / trace id |
+----------------------------------------------------------------------------------+
| Agent Profiles                                                                   |
| [Agent Card] [Agent Card] [Agent Card]                                           |
| name / credential status / token prefix / budget / calls / success / last error |
+----------------------------------------------------------------------------------+
| Recent Invocation Preview                                                        |
| latest 5 invocations, status, cost, latency, trace id                           |
+----------------------------------------------------------------------------------+
| Developer Drawer                                                                 |
| SDK install / credential usage / discovery / invoke snippets                    |
+----------------------------------------------------------------------------------+
```

## 5. Functional Modules

### 5.1 Status Strip

Purpose:

give the Owner a single-row answer to “what is my current activation state?”

Must display:

1. wallet connected / disconnected
2. session authenticated / missing
3. spendable balance
4. active agents count
5. last successful invocation timestamp
6. next recommended CTA

Primary CTA logic:

1. if wallet disconnected: `Connect Wallet`
2. if session missing: `Sign In`
3. if balance is zero: `Add Funds`
4. if no agent exists: `Create Agent`
5. if agent exists but no successful invocation: `Run First Paid Invocation`

### 5.2 Activation Runway

Purpose:

turn activation into an explicit finite workflow instead of a loose checklist.

Must contain four cards:

1. Fund Owner Vault
2. Create Agent Runtime
3. Issue Credential
4. Run First Paid Invocation

Each card should show:

1. state: `LOCKED | READY | DONE | BLOCKED`
2. help tooltip on `?` hover/focus; hide when pointer leaves
3. current value summary
4. action button
5. dependency hint

Example:

1. Fund Owner Vault
  - summary: `0.00 USDC available`
  - CTA: `Deposit USDC`
  - unauthenticated click behavior: open wallet connect modal first, then continue to session sign-in / deposit flow
  - tooltip: explain that wallet USDC moves into Synapse Vault as spendable runtime credit
2. Create Agent Runtime
  - summary: `No active agent`
  - CTA: `Create Agent`
  - tooltip: explain runtime identity, budget, and call limits
3. Issue Credential
  - summary: `Token not issued yet` or `Token prefix: ag_xxxx`
  - CTA: `Copy Credential` or `Rotate Credential`
  - tooltip: explain one-time credential copy and secure storage
4. Run First Paid Invocation
  - summary: `No successful invocation yet`
  - CTA: `Run Example`
  - tooltip: explain this proves the first autonomous paid call path end-to-end

Card body should stay compact:

1. remove long explanatory paragraphs from the card body
2. keep durable information in summary + hint
3. move narrative explanation into tooltip only

### 5.3 First Invocation Panel

Purpose:

teach and prove how a real agent runtime uses the credential.

This is the most important missing module.

It should contain four subareas:

1. Discovery example
2. Quote example
3. Invoke example
4. Run example result area

#### A. Discovery Example

Show executable snippets for:

1. TypeScript
2. Python
3. cURL

Minimum content:

1. base URL
2. credential header usage
3. discovery request example
4. minimal response explanation

#### B. Quote Example

Show:

1. service selection input
2. quote request body
3. returned quote price
4. TTL / quote status explanation

#### C. Invoke Example

Show:

1. invoke request
2. idempotency key requirement
3. expected structured result
4. stable error behavior

#### D. Run Example / Sandbox Invocation

Allow the user to test an official demo service using the current agent credential.

Returned result panel should show:

1. invocation status
2. charged USDC
3. quote amount
4. latency
5. output preview
6. trace id / request id

This is the bridge from “I created an agent” to “I understand how my agent actually uses the platform”.

### 5.4 Agent Profiles List

Purpose:

be the persistent operational truth surface after activation is complete.

Each agent card should ultimately include:

1. agent name
2. credential status
3. token prefix
4. daily budget used / limit
5. lifetime usage summary
6. last 24h invocations
7. success rate
8. last error
9. quick actions

Quick actions:

1. `Copy Token Prefix`
2. `Open SDK Snippet`
3. `Open Discovery`
4. `Rotate Credential`
5. `Revoke`

### 5.5 Recent Invocation Preview

Purpose:

show proof that the agent has actually moved beyond setup.

Each row should display:

1. agent name
2. service name
3. status
4. charged USDC
5. latency
6. trace id
7. timestamp

### 5.6 Developer Drawer

Purpose:

keep the code path close to the activation path.

Should include:

1. SDK install command
2. environment variable setup
3. credential injection example
4. discovery snippet
5. quote snippet
6. invoke snippet
7. docs links to deeper developer pages

## 6. Component Split Plan

Recommended v3 component structure under the agents feature:

1. `ActivationStatusStrip.tsx`
  - top status row
  - computes next best action

2. `ActivationRunway.tsx`
  - renders the four-step activation cards
  - manages `READY / DONE / BLOCKED` state presentation

3. `RunwayStepCard.tsx`
  - reusable card for fund / create / issue / invoke

4. `FirstInvocationPanel.tsx`
  - central runtime education area

5. `InvocationSnippetTabs.tsx`
  - TypeScript / Python / cURL tab switcher

6. `DiscoverySnippet.tsx`
  - discover example

7. `QuoteSnippet.tsx`
  - quote example

8. `InvokeSnippet.tsx`
  - invoke example

9. `InvocationSandboxResult.tsx`
  - shows actual result of one-click example run

10. `AgentProfilesGrid.tsx`
   - owns list layout and empty/loading state

11. `AgentProfileCard.tsx`
   - one card per agent

12. `CredentialLifecyclePanel.tsx`
   - copy / rotate / revoke / masked display concerns

13. `RecentInvocationsPreview.tsx`
   - latest invocation rows

14. `DeveloperQuickstartDrawer.tsx`
   - SDK and example commands

15. `CreateAgentModal.tsx`
   - extracted from page for cleaner ownership

16. `IssuedCredentialModal.tsx`
   - extracted one-time token display and save confirmation

### 6.1 Current components that remain valid

The current `QuickStartGuide.tsx` still remains useful in v3, but its role should narrow:

1. either evolve into `ActivationRunway.tsx`
2. or be decomposed into the runway + first invocation modules listed above

## 7. User Flow Definition

The target user flow on the page should be:

1. Owner opens Agents page
2. page computes current activation state
3. page highlights the next best action
4. Owner deposits USDC
5. Owner creates agent runtime
6. Owner copies issued credential
7. page immediately reveals discovery / quote / invoke examples
8. Owner runs one-click sample invocation
9. page shows successful invocation result and billing proof
10. Owner transitions from activation to ongoing agent operations

## 8. Information Architecture Rules

This page must not force the Owner to jump across multiple pages just to understand the runtime loop.

Therefore:

1. `Create Agent` cannot be the end of the page story
2. `Credential Issued` cannot be treated as product success
3. discovery and invoke education must live on the page itself
4. runtime proof must be visible on the same page
5. navigation to `Discovery`, `Invocations`, and `Developer` should be deep links, not mandatory prerequisites for understanding first use

## 9. Docs-Code Consistency Rule

As of now, code and docs are aligned on the current v2 state:

1. quick start onboarding exists
2. deposit and create agent exist on the page
3. credential issue and one-time reveal exist
4. page is not yet upgraded to full activation runway + first invocation panel

Therefore this document intentionally separates:

1. `Current Implemented State`
2. `V3 Product Direction`

Future code changes to the agents page must update this file in the same PR when any of these modules ship:

1. status strip
2. activation runway
3. first invocation panel
4. developer quickstart drawer
5. recent invocation preview

## 10. Next Implementation Order

Recommended execution order:

1. add `ActivationStatusStrip`
2. refactor `QuickStartGuide` into `ActivationRunway`
3. add `FirstInvocationPanel`
4. split modals and card grid into dedicated components
5. add `RecentInvocationsPreview`
6. add `DeveloperQuickstartDrawer`

This sequence keeps the page shippable at every step while moving it toward the real activation goal.
