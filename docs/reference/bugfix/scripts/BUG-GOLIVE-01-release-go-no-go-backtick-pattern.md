# BUG-GOLIVE-01 - release Go/No-Go check executed Markdown backticks

## Reproduction

Run:

```bash
npm run ci:release-go-no-go
```

The new release evidence check failed before evaluating the validation document. Bash attempted to execute Markdown backtick text from grep patterns, producing errors such as:

```text
scripts/ci/release_go_no_go_checks.sh: line 41: BLOCKED_NO_GO: command not found
scripts/ci/release_go_no_go_checks.sh: line 42: NO-GO: command not found
scripts/ci/release_go_no_go_checks.sh: line 43: PASS: command not found
```

It also invoked the system `go` command because the pattern contained `` `GO` `` inside double quotes.

## Root Cause

`scripts/ci/release_go_no_go_checks.sh` used double-quoted grep patterns containing Markdown backticks. In bash, backticks trigger command substitution even when they are inside double quotes.

## Fix

Changed every grep pattern that includes Markdown backticks to single-quoted strings so bash treats the backticks as literal characters.

## Verification

Run:

```bash
npm run ci:release-go-no-go
npm run ci:docs
amem plan-check .
bash -n scripts/ci/release_go_no_go_checks.sh scripts/ci/pr_checks.sh
```

## Residual Risk

The script intentionally passes when staging automation evidence is recorded and production blockers are explicit. It must not be interpreted as production launch approval; production remains blocked until the external P0 evidence is attached.
