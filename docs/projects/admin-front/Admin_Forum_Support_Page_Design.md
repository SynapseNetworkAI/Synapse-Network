# Admin Forum Support Page Design

- Status: canonical
- Code paths: `services/admin-front/src/app/forum-support/`, `services/gateway-admin/src/api/routers/forum_support.py`
- Verified with: `cd services/admin-front && yarn test src/features/forum-support/forum-support-presenters.test.ts src/services/admin-api.test.ts`, `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k forum_support`
- Last verified against code: 2026-04-19
- Last updated: 2026-04-19

## Purpose

`/forum-support` is the admin operations workbench for turning public forum signals into reviewed replies. It is not the public forum and it is not an auto-support bot. Growing/Agent may classify posts and draft suggestions, but every public reply must be reviewed, edited, and sent by an administrator.

## Roles And Permissions

1. `support:read` can view the response-task queue and topic context.
2. `support:reply` can send a public forum reply from the reviewed workbench.
3. `support:triage` can ignore a response task with a reason.
4. `X-Growing-Service-Token` is used only by Growing/Agent internal endpoints that read pending tasks or write suggestions.

## State Machine

1. `awaiting_response`: a forum topic needs a human response. The reply editor is writable.
2. `draft_ready`: Growing/Agent has written classification, priority, links, and a suggested reply. The reply editor is writable and prefilled.
3. `responded`: an administrator sent a public reply. The task is historical and read-only.
4. `ignored`: an administrator intentionally closed the task without a public reply. The task is historical and read-only.
5. `closed`: reserved for later system or batch closure. The task is historical and read-only.

## Information Architecture

The page uses a two-column operations layout:

1. Header: title, description, `待回复 / 历史` toggle, and refresh.
2. Metrics: queue size, draft-ready count, bug signals, high-priority count.
3. Left column: dense queue list with priority, status, classification, topic title, author, and category.
4. Right top: topic context, original post body, author, time, status, priority, and Growing links.
5. Right bottom: human-reviewed reply area, prefilled from Agent suggestion when available.

## Interaction Rules

1. Clicking a queue item switches the right-side context in-place. It must not navigate away.
2. Agent suggestions must be editable before sending.
3. Sending is disabled when no active task is selected, the reply has fewer than two non-space characters, or a request is in flight.
4. Ignoring is disabled when no active task is selected, the reason has fewer than three non-space characters, or a request is in flight.
5. Historical tasks are read-only. The page may show their final state, but it must not allow duplicate send or ignore actions.
6. Errors render at the workbench top and must not clear the selected context.
7. Growing Candidate, Requirement, and Workflow links open in a new tab as small pills. They are references, not automatic actions.

## Failure Handling

1. Locked forum topics return an explicit error and do not create replies.
2. Already closed tasks return not found or already closed semantics and remain safe to retry from the queue.
3. API failures should preserve the draft text in the editor so the operator can retry or copy it.
4. Public replies, finance commitments, production outage claims, and compensation statements must never be auto-sent from Agent text.

## Backend Contract

Admin browser endpoints use `/api/admin/v1/forum/response-tasks`:

1. `GET /api/admin/v1/forum/response-tasks`
2. `GET /api/admin/v1/forum/response-tasks/{taskId}`
3. `POST /api/admin/v1/forum/response-tasks/{taskId}/send-reply`
4. `POST /api/admin/v1/forum/response-tasks/{taskId}/ignore`

Growing internal endpoints use the same prefix:

1. `GET /api/admin/v1/forum/response-tasks/-/pending`
2. `POST /api/admin/v1/forum/response-tasks/{taskId}/suggestion`

## Verification

The page passes when:

1. The default filter requests `awaiting_response,draft_ready`.
2. The history filter requests `responded,ignored,closed`.
3. Queue metrics match the currently visible task set.
4. Selecting a task updates context, suggested reply, and Growing links.
5. Send and ignore buttons enforce the active-task and minimum-length rules.
6. Sending calls the admin API, refreshes the queue, and shows a success notice.
7. Ignoring calls the admin API, refreshes the queue, and shows a success notice.
8. Historical tasks render read-only and cannot be sent again.
