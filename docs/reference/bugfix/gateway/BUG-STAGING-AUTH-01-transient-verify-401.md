# BUG-STAGING-AUTH-01: transient staging auth verify 401 during E2E reruns

## Symptom

Fresh staging `gateway-fullchain` reruns reached the final API reference step and
failed intermittently on:

- `POST /api/v1/auth/verify`
- status `401`

The same wallet succeeded immediately before and immediately after, which made
the failure look flaky instead of deterministic.

## What we observed

Gateway logs around the same minute showed a mixed pattern:

- some `auth/verify` requests returned `200`
- a few returned `401`
- the next fresh challenge/verify pair often succeeded again

## Fix

Harden the E2E auth helper `authenticate_wallet()` so it retries the full
challenge → sign → verify exchange up to 3 times when staging returns a
transient `400/401`.

This is a harness-only robustness fix. It does not relax production auth
behavior; it only prevents staging flake from failing release evidence after
the money path has already passed.
