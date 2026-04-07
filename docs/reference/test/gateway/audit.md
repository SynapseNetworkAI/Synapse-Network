# Test Plan: Risk & Audit Page

**Route:** `/dashboard/audit`  
**Component:** `DashboardAuditPage` (RiskAuditPage)

## Purpose
Security alerts and audit trail log. Static/mock data currently. Shows alert severity and relative timestamps.

## Test Cases

### TC-AU-01: Page renders without crash
- Navigate to `/dashboard/audit`
- **Expected:** Page loads with alerts section and audit trail table

### TC-AU-02: Alert cards visible
- **Expected:** Alert severity badges (critical/high/medium/low) shown in cards

### TC-AU-03: Audit trail table rows
- **Expected:** Table columns: Event, Actor, Time (relative) visible

### TC-AU-04: Relative time formatting
- **Expected:** Times shown as "X minutes ago", "X hours ago", "X days ago"

### TC-AU-05: Alert tone color coding
- Critical → red/rose badge
- High → orange badge
- **Expected:** Color-coded severity indicators

## Pass Criteria
Page loads, alert cards and audit trail both visible.
