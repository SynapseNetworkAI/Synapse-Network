# Agent Lessons: codex-admin-rbac-sidebar-panel-links

Task: Fix Admin RBAC sidebar panel links and add DOM-level dogfood coverage.
Status: Active

## Push Review

## Lessons

### Lesson: Page nodes with children need separate navigation and expansion semantics

- Domain: frontend
- Severity: warning
- Trigger: The Admin sidebar rendered `role-permissions` as a page with child panels, but the tree component treated every node with children as expand-only.
- Root cause: Navigation logic conflated hierarchy with non-navigability, so a real page lost its link as soon as child panel nodes were attached.
- Fix: Keep category nodes expand-only, but render page/panel nodes with paths as links and use a separate expand/collapse control for children.
- Rule: Tree navigation components must model `nodeType` and `path` independently; having children must not automatically remove page navigation.
- Upgrade: agents-memory
