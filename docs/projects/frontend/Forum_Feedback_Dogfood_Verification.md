# Forum Feedback Dogfood Verification

- Status: canonical
- Code paths: `services/user-front/src/app/forum/`, `services/user-front/src/components/feedback/`, `scripts/e2e/forum_feedback_seed.mjs`, `scripts/ui/dogfood_forum_feedback.mjs`
- Scope: user-front `/forum`, docs support feedback, dashboard feedback, gateway community API, Postgres persistence
- Last verified against code: 2026-04-19
- Primary commands:
  - `node scripts/e2e/forum_feedback_seed.mjs`
  - `node scripts/ui/dogfood_forum_feedback.mjs`

## Purpose

This runbook verifies that Synapse users have a working feedback loop:

1. Public users can browse the Developer Forum.
2. Authenticated wallet users can create a topic, reply, and mark the topic resolved.
3. Docs and dashboard feedback drawers submit feedback and return a `feedbackId`.
4. Browser-created form data is actually persisted in Postgres.
5. Screenshots and a machine-readable report are produced for regression evidence.

Screenshots are evidence for visual review. The functional pass/fail decision comes from browser clicks, Gateway API responses, and Postgres reconciliation.

## Page Function Matrix

| Surface            | Route                  | Required behavior                                                                                                                                                | Evidence                                                                       |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Forum list         | `/forum`               | Shows categories, search, latest/top controls, pinned/status badges, views, topic list, and opens topic creation in a modal instead of inline-expanding the list | `forum-public.png`, browser assertions                                         |
| Create topic modal | `/forum`               | `New topic` opens a modal overlay; unauthenticated users see the guard and authenticated users can submit the form                                               | `forum-create-topic-modal-unauthenticated.png`, `forum-create-topic-modal.png` |
| Topic detail       | `/forum/{topicId}`     | Shows topic body, replies, views, official-reply count, status badges, close reason, reply lock, and back link                                                   | `forum-topic-detail.png`, `forum-reply-resolved.png`, `forum-topic-closed.png` |
| Docs support       | docs-front `/support`  | Shows support hub and Developer Forum link                                                                                                                       | `docs-support.png`, URL assertion                                              |
| Dashboard feedback | `/dashboard/discovery` | Floating `Feedback` opens drawer and returns `feedbackId` with route context                                                                                     | `dashboard-feedback-drawer.png`, API + DB assertion                            |

## Local Setup

Start the local stack first:

```bash
bash scripts/local/setup_local_env.sh
sh scripts/local/restart_gateway.sh
cd services/user-front
yarn dev
```

If Next chooses a different port, pass it explicitly:

```bash
FORUM_BASE_URL=http://localhost:3001 node scripts/ui/dogfood_forum_feedback.mjs
```

The gateway database must already contain:

- `synapse_feedback_reports`
- `synapse_forum_topics`
- `synapse_forum_replies`
- `synapse_forum_topic_events`

Gateway startup intentionally does not auto-run DB bootstrap scripts. Apply the schema/bootstrap before running this verification.

## Commands

Create deterministic API seed data and wallet JWT fixture:

```bash
node scripts/e2e/forum_feedback_seed.mjs
```

Run browser dogfood plus DB reconciliation:

```bash
FORUM_BASE_URL=http://localhost:3000 \
GATEWAY_BASE_URL=http://127.0.0.1:8000 \
node scripts/ui/dogfood_forum_feedback.mjs
```

If `POSTGRES_DSN` is omitted, the script reads `services/gateway/.env.local` and falls back to the documented local bootstrap DSN.

Run narrow static/unit checks:

```bash
cd services/gateway
.venv/bin/python -m pytest tests/unit/test_community_router_unit.py
```

```bash
cd services/user-front
yarn test src/app/forum/ForumPage.test.tsx src/components/feedback/FeedbackDrawer.test.tsx
```

```bash
npm run ci:user-front-pages
npm run ci:docs
```

## Output

The browser script writes evidence to:

```text
output/dogfood/forum-feedback/<timestamp>/
```

Expected files:

- `report.md`
- `report.json`
- `screenshots/forum-public.png`
- `screenshots/forum-list.png`
- `screenshots/forum-create-topic-modal-unauthenticated.png`
- `screenshots/forum-create-topic-modal.png`
- `screenshots/forum-topic-detail.png`
- `screenshots/forum-reply-resolved.png`
- `screenshots/docs-support.png`
- `screenshots/docs-feedback-drawer.png`
- `screenshots/dashboard-feedback-drawer.png`

Temporary fixture:

```text
tmp/forum-feedback-dogfood/fixture.json
```

The fixture contains the run id, wallet JWT, seed feedback ids, seed topic id, seed reply id, and expected UI form values. It is local evidence and must not be committed.

## Database Reconciliation

The dogfood script verifies the following:

- `synapse_feedback_reports` contains the seed dashboard feedback and UI dashboard feedback.
- Dashboard feedback has `source='dashboard'` and a `/dashboard/discovery` route.
- `context_json` and `message` do not leak JWTs, bearer tokens, private keys, provider secrets, or agent tokens.
- `synapse_forum_topics` contains the seed topic and UI-created topic.
- Both seed and UI topics are marked `resolved=true`.
- `synapse_forum_replies` contains the seed reply and UI-created reply.
- UI-created rows match the exact form values used by the browser.

Useful manual SQL when debugging:

```sql
SELECT feedback_id, source, route, message, context_json
FROM synapse_feedback_reports
WHERE message ILIKE '%forum-YYYYMMDD%';
```

```sql
SELECT topic_id, title, category, status, resolved, pinned, views_count, replies_count, closed_reason
FROM synapse_forum_topics
WHERE title ILIKE '%forum-YYYYMMDD%';
```

```sql
SELECT reply_id, topic_id, body, status
FROM synapse_forum_replies
WHERE body ILIKE '%forum-YYYYMMDD%';
```

## Pass Criteria

The verification passes only when:

- `report.json.failed.length === 0`.
- Forum topic, reply, and feedback rows exist in Postgres.
- UI text, API response ids, DB rows, and fixture values agree.
- `New topic` opens a modal overlay and does not inline-expand the create form in the forum list flow.
- `/forum` to `/forum/{topicId}` navigation works.
- Public `/forum` displays pinned/status/views fields when the seed or admin action sets them.
- Topic detail increments `views_count` on successful reads. If visitor-window dedupe is enabled later, the report must state whether it expects raw views or deduped views.
- Closed topics remain publicly visible, show the close reason, and disable the reply form.
- Pinned topics appear above ordinary topics in the public list.
- Docs-front support links are covered by docs browser verification.
- Dashboard feedback drawer displays a `feedbackId`.
- All required screenshots exist.
- Browser console has no uncaught error.

## Bugfix Policy

If the script finds a product or test bug:

1. Add a bug record under `docs/reference/bugfix/frontend/BUG-FORUM-DOGFOOD-XX-*.md`.
2. Include reproduction, root cause, fix, verification command, and residual risk.
3. Fix the issue.
4. Re-run `node scripts/e2e/forum_feedback_seed.mjs`.
5. Re-run `node scripts/ui/dogfood_forum_feedback.mjs`.
6. Only mark verified after the report has zero failures.
