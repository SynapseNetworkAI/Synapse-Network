# Admin Forum Support Page Design

- Status: canonical
- Code paths: `services/admin-front/src/app/forum-support/`, `services/gateway-admin/src/api/routers/forum_support.py`
- Verified with: `cd services/admin-front && yarn test src/features/forum-support/forum-support-presenters.test.ts src/services/admin-api.test.ts`, `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k forum_support`
- Last verified against code: 2026-04-19
- Last updated: 2026-04-19

## Purpose

`/forum-support` is the admin operations workbench for turning public forum signals into support tickets. It is not the public forum and it is not an auto-support bot. Growing/Agent may classify posts and draft suggestions, but every public reply, close, pin, or reopen action must be reviewed and triggered by an administrator.

## Roles And Permissions

1. `support:read` can view all forum topics, response tasks, original topic context, and lifecycle events.
2. `support:reply` can send a public forum reply from the reviewed workbench.
3. `support:triage` can ignore a response task, close/reopen topics, and pin/unpin topics with audit trail.
4. `X-Growing-Service-Token` is used only by Growing/Agent internal endpoints that read pending tasks or write suggestions.

## State Machine

### Public Topic Lifecycle

1. `open`: public and replyable. It may or may not need an official response.
2. `awaiting_admin`: public and replyable, but waiting for an official response and eligible for the response queue.
3. `answered`: an official reply exists. The topic remains replyable.
4. `resolved`: the author or admin marked the issue solved. Follow-up replies remain allowed by default.
5. `closed`: public and readable, but replies are locked. This is not content removal.
6. `hidden`: hidden from public APIs and only visible through moderation/admin paths.
7. `locked`: legacy/compatibility lock state; users cannot reply.

### Response Task Lifecycle

1. `awaiting_response`: a forum topic needs a human response. The reply editor is writable.
2. `draft_ready`: Growing/Agent has written classification, priority, links, and a suggested reply. The reply editor is writable and prefilled.
3. `responded`: an administrator sent a public reply. The task is historical and read-only.
4. `ignored`: an administrator intentionally closed the task without a public reply. The task is historical and read-only.
5. `closed`: reserved for later system or batch closure. The task is historical and read-only.

## Information Architecture

The page uses a dual-view operations layout:

1. Header: title, description, `All Topics / Response Queue / History` toggle, and refresh.
2. `All Topics`: paginated topic list with search, status filter, pinned filter, topic badges, replies, views, official replies, and last activity.
3. `All Topics` detail: original post body, status badges, views count, replies count, official replies count, close reason, lifecycle timeline, and moderation actions.
4. `Response Queue`: dense queue list with priority, status, classification, topic title, author, and category.
5. `Response Queue` detail: topic context, original post body, author, time, status, priority, Growing links, and human-reviewed reply editor.

## Interaction Rules

1. Clicking a topic or queue item switches the right-side context in-place. It must not navigate away.
2. Agent suggestions must be editable before sending.
3. Sending is disabled when no active task is selected, the reply has fewer than two non-space characters, or a request is in flight.
4. Ignoring is disabled when no active task is selected, the reason has fewer than three non-space characters, or a request is in flight.
5. Historical tasks are read-only. The page may show their final state, but it must not allow duplicate send or ignore actions.
6. Errors render at the workbench top and must not clear the selected context.
7. Growing Candidate, Requirement, and Workflow links open in a new tab as small pills. They are references, not automatic actions.
8. Closing a topic requires a reason. The topic remains public, but public replies become disabled.
9. Reopening a topic clears the close reason and allows public replies again.
10. Pinning and unpinning only affect public list ordering; they do not change the response-task state.

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

Admin topic lifecycle endpoints use `/api/admin/v1/forum/topics`:

1. `GET /api/admin/v1/forum/topics`
2. `GET /api/admin/v1/forum/topics/{topicId}`
3. `POST /api/admin/v1/forum/topics/{topicId}/close`
4. `POST /api/admin/v1/forum/topics/{topicId}/reopen`
5. `POST /api/admin/v1/forum/topics/{topicId}/pin`
6. `POST /api/admin/v1/forum/topics/{topicId}/unpin`

## Verification

The page passes when:

1. `All Topics` requests active public topic statuses by default and uses backend pagination.
2. The queue filter requests `awaiting_response,draft_ready`.
3. The history filter requests `responded,ignored,closed`.
4. Topic metrics match the visible topic list; queue metrics match the visible task list.
5. Selecting a topic updates detail, lifecycle timeline, close reason, and moderation buttons.
6. Selecting a task updates context, suggested reply, and Growing links.
7. Send and ignore buttons enforce the active-task and minimum-length rules.
8. Closing requires a reason and refreshes the list with status `closed`.
9. Reopening unlocks the topic and restores status `open`.
10. Pin/unpin refreshes the list and changes the topic badge/sort state.
11. Historical tasks render read-only and cannot be sent again.

## Dogfood E2E

The end-to-end admin verification lives in [Admin_Front_Dogfood_E2E_Runbook.md](./Admin_Front_Dogfood_E2E_Runbook.md).

Forum Support must pass the dogfood path:

1. Seed a public forum topic and `draft_ready` response task.
2. Open `/forum-support` as an authenticated admin.
3. Verify `All Topics` shows the seeded topic with views/replies/pinned/status fields.
4. Pin the topic and verify public `/forum` list places it above normal topics.
5. Close the topic with a reason and verify public `/forum/{topicId}` disables replies.
6. Reopen the topic and verify replies are enabled again.
7. Switch to `Response Queue`, verify the seeded task and Agent suggestion are editable.
8. Send a human-edited reply.
9. Verify gateway DB has a `synapse_forum_replies` row and the task is `responded`.
10. Verify the dogfood report has no browser failures, hidden 500s, or console errors.
