### Lesson: Verify local admin ports belong to the current worktree before trusting E2E evidence.

Admin-front on `3200` and gateway-admin on `8300` can be silently served by a sibling Synapse worktree, which makes DOM/API/SQL evidence look stale even when the current branch code is correct. Before running admin withdrawal-review E2E, confirm both ports resolve to the current repo paths or restart the local app stack from the active worktree first.
