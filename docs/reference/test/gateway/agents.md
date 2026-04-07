# Test Plan: Agents Page

**Route:** `/dashboard/agents`  
**Component:** `DashboardAgentsWorkspacePage`

## Purpose
Agent credential management — create, list, edit quota, revoke agent credentials.

## Test Cases

### TC-AG-01: Page renders without crash
- Navigate to `/dashboard/agents`
- **Expected:** Page loads, agent list or empty-state shown

### TC-AG-02: Agent list table visible
- **Expected:** Table with columns (Agent ID, Created, Status, Quota) visible

### TC-AG-03: Create Agent button present
- **Expected:** "Create Agent" or "+" button in header area

### TC-AG-04: Create Agent modal opens
- Click create button
- **Expected:** Modal opens with fields (name/quota/spend limit)

### TC-AG-05: Copy agent token works
- On an existing agent row, click copy icon
- **Expected:** Tooltip/visual feedback "Copied"

### TC-AG-06: Edit quota modal opens
- Click Edit on an agent
- **Expected:** Edit modal opens with pre-filled quota values (max_calls, rpm, daily_budget)

### TC-AG-07: Agent detail pane opens
- Click agent row
- **Expected:** Side pane opens showing agent invocation history

### TC-AG-08: Revoke credential confirmation
- Click revoke on an agent
- **Expected:** Confirmation dialog shown before deletion

## Pass Criteria
All P0/P1 cases pass. Create + Edit flows open their modals without crash.
