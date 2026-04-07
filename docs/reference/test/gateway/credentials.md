# Test Plan: Provider Credentials Page

**Route:** `/dashboard/credentials`  
**Component:** `DashboardCredentialsPage` → `CredentialsContent`

## Purpose
Issue agent credentials scoped to specific provider services. Configure expiry, max_calls, rpm, daily_budget.

## Test Cases

### TC-CR-01: Page renders without crash
- Navigate to `/dashboard/credentials`
- **Expected:** Page loads with credential issuance form

### TC-CR-02: Service filter / dropdown present
- **Expected:** Service selector input visible

### TC-CR-03: Expiry options available
- **Expected:** Dropdown/select with options: Never / 1 Hr / 1 Day / 30 Days

### TC-CR-04: Quota fields present
- **Expected:** max_calls, rpm, daily_budget inputs visible

### TC-CR-05: Issue Credential button present
- **Expected:** Submit button visible

### TC-CR-06: Existing credentials table shown
- **Expected:** Table listing previously issued credentials

### TC-CR-07: Edit quota on existing credential
- Click Edit on a credential row
- **Expected:** Edit modal opens with pre-filled values

### TC-CR-08: Wallet auth required
- Without wallet session — appropriate error shown ("Wallet auth session missing")

## Pass Criteria
Page loads, credential form and table visible.
