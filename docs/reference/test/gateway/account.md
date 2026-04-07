# Test Plan: Account Settings Page

**Route:** `/dashboard/account/settings`  
**Component:** `AccountSettingsPage`

## Purpose
Owner profile settings — display name, notification preferences, wallet management.

## Test Cases

### TC-AC-01: Page renders without crash
- Navigate to `/dashboard/account/settings`
- **Expected:** Page loads with settings form

### TC-AC-02: Settings form fields present
- **Expected:** Display name, email, or other profile fields visible

### TC-AC-03: Wallet info shown
- **Expected:** Connected wallet address shown (truncated)

### TC-AC-04: Save changes button present
- **Expected:** Submit/Save button visible in form

### TC-AC-05: Unstable wallet error handling
- **Expected:** If wallet unstable, `isWalletUnstableError` condition shows graceful message

### TC-AC-06: Form validation
- Submit empty required fields
- **Expected:** Inline validation errors shown

## Pass Criteria
Page loads, form fields visible, no crash.
