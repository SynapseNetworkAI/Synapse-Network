# Lark Alert E2E Evidence

- Status: success
- Run ID: lark-e2e-mo9ml0xn-lutsy8
- Started At: 2026-04-22T05:41:54.299Z
- Finished At: 2026-04-22T05:41:55.779Z
- Sent Messages: 7

## Endpoint Configuration

| Endpoint | Webhook Configured | Secret Configured |
| --- | --- | --- |
| /lark/p0-war-room | yes | no |
| /lark/prod-alerts | yes | no |
| /lark/staging-drill | yes | no |

## Message Results

| Scenario | Endpoint | Status | Alerts | Folded | HTTP | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| p0-firing | /lark/p0-war-room | firing | 1 | 0 | 200 | pass |
| p0-resolved | /lark/p0-war-room | resolved | 1 | 0 | 200 | pass |
| prod-firing | /lark/prod-alerts | firing | 1 | 0 | 200 | pass |
| prod-resolved | /lark/prod-alerts | resolved | 1 | 0 | 200 | pass |
| staging-firing | /lark/staging-drill | firing | 1 | 0 | 200 | pass |
| staging-resolved | /lark/staging-drill | resolved | 1 | 0 | 200 | pass |
| staging-batch-folding | /lark/staging-drill | firing | 100 | 99 | 200 | pass |

## Failures

- none
