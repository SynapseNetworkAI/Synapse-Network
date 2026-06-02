# Synapse User Feedback and Developer Forum

## Purpose

Synapse needs a first-class signal loop for developers. v1 has three channels:

- Docs support: the dedicated docs site links users to forum, support, and issue-reporting channels.
- Dev Console feedback: dashboard-context bug or product feedback with route/query context.
- Developer Forum: public community discussions for questions, bugs, feature requests, provider services, SDKs, and showcases.

The design goal is low-friction reporting without leaking secrets. Feedback and forum content must never submit or render JWTs, private keys, provider secrets, agent tokens, or authorization headers.

## Surfaces

### Docs

- Docs live in `services/docs-front` on `docs.synapse-network.ai`.
- Main-site `/docs/*` routes redirect to the dedicated docs origin.
- `/support` on docs-front links to Forum, Billing Support, Bug Report, Docs Issue, GitHub, and Status.

### Dev Console

- Top nav `Forum` routes to `/forum`, not `/blog`.
- Dashboard pages render a low-disturbance `Feedback` floating button.
- Feedback opens a centered modal overlay. Do not use a side drawer or sidebar expansion for product feedback.
- Feedback from dashboard pages includes route, query params, surface, and a masked wallet address when available.
- Successful submissions return a `feedbackId` that users can reference in support or forum posts.

### Developer Forum

- `/forum` is publicly browsable.
- Creating topics, replying, and marking a topic resolved require wallet JWT.
- Creating a topic opens a modal overlay. The forum list page must remain a scanning surface with categories, search, sorting, and topics; it must not inline-expand the create-topic form in the list flow.
- Categories are fixed for v1: `Announcements`, `Questions`, `Bugs`, `Feature Requests`, `Provider Services`, `SDKs`, `Showcase`.
- Topic detail pages show the sanitized markdown text as plain text and never render raw HTML.
- Authors can mark their own topic resolved.
- Topics behave like public support tickets. The detail page shows category, author, status badges, pinned state, official-reply count, replies count, and `Views N`.
- Status values are `open`, `awaiting_admin`, `answered`, `resolved`, `closed`, `hidden`, and legacy `locked`.
- `closed` means public and readable, but no new replies. It is not the same as `hidden`.
- `pinned=true` topics sort above normal topics and display a `Pinned` badge in list and detail views.
- Reading a public topic increments `viewsCount` at the gateway API. v1 treats this as raw page views; a 30-minute visitor window can be added later if refresh inflation becomes noisy.
- `open`, `awaiting_admin`, and `answered` allow authenticated replies. `resolved` still allows follow-up discussion. `closed`, `hidden`, and `locked` disable the reply form.

### Admin Forum Support

- Public forum topics that need an operator response are mirrored into the admin `/forum-support` response-task queue.
- The admin workbench is a community-support operations desk, not an auto-support robot.
- `/forum-support` has two main views:
- `All Topics`: paginated topic lifecycle management with search, status, pinned state, replies, views, official replies, close/reopen, and pin/unpin.
- `Response Queue`: the existing reviewed reply queue with Agent suggestions and human-edited public replies.
- Growing/Agent may write classification, priority, suggested reply text, and links to Candidate / Requirement / Workflow follow-up records.
- The suggested reply is advisory only. A human administrator must review, edit, and manually send every public response.
- Sending from the admin workbench creates a real forum reply and moves the task to `responded`.
- Ignoring from the admin workbench requires a reason and moves the task to `ignored`.
- Historical tasks are read-only so an operator cannot accidentally send duplicate public replies.
- Forum signals that represent bugs, feature requests, or provider-service gaps should be linked to Growing planning artifacts rather than handled only as chat.
- Admin close/reopen/pin/unpin actions write lifecycle events for audit and operational handoff.
- Closing a topic keeps it visible to users, shows the close reason, and disables further replies.

## Gateway API

- `POST /api/v1/feedback`
- `GET /api/v1/forum/topics`
- `POST /api/v1/forum/topics`
- `GET /api/v1/forum/topics/{topicId}`
- `POST /api/v1/forum/topics/{topicId}/replies`
- `POST /api/v1/forum/topics/{topicId}/resolve`

Feedback may be anonymous. Forum writes require wallet JWT.

## Data Model

The canonical Postgres bootstrap schema defines:

- `synapse_feedback_reports`
- `synapse_forum_topics`
- `synapse_forum_replies`
- `synapse_forum_reactions`
- `synapse_forum_topic_events`

Existing local databases need the gateway bootstrap schema reapplied or an equivalent migration before the new endpoints can persist data. Gateway startup must not run schema scripts implicitly.

## Security Rules

- Server and client both redact sensitive keys and obvious secret values.
- Forum text is treated as safe markdown/plain text and rendered without `dangerouslySetInnerHTML`.
- Rate limits protect feedback, topic creation, and replies.
- Feedback/forum analytics events are emitted for observability.
- v1 does not include a dedicated admin feedback inbox; operators can inspect database rows and audit/analytics events.

## Verification

Required automated checks:

- Gateway router tests verify feedback creation, forum auth requirements, topic creation, and redaction helpers.
- Frontend tests verify feedback modal submission redacts sensitive context.
- Frontend tests verify forum list rendering and authenticated topic creation.
- Frontend tests verify pinned/status/views badges and closed-topic reply lock behavior.
- Docs-front browser checks verify `/support` renders and links users to the right support channels.

Required browser checks:

- Open docs-front `/support`, verify the support channel links, and capture screenshot.
- Open `/dashboard/discovery`, click floating `Feedback`, verify modal route context.
- Open console top nav `Forum`, verify URL `/forum`.
- Open `New topic`, verify the create-topic modal overlay, create forum topic, reply, mark resolved, and capture list/modal/detail screenshots.
- Visit a topic twice, verify `Views` increases from the gateway truth.
- Close a topic from `/forum-support`, verify public detail remains visible but the reply form is disabled.
- Pin a topic from `/forum-support`, verify public `/forum` list displays the `Pinned` badge and prioritizes the topic.

Pass criteria:

- No uncaught browser console errors.
- All expected API calls return 2xx or expected auth 401/403.
- No feedback/forum payload contains raw `Authorization`, JWT, private key, provider secret, or agent token.
- Public forum browsing works without auth; writes are blocked without auth.
