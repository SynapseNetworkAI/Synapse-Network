# ruff: noqa: TRY003 -- admin config raises stable user-facing API errors from service boundaries.
from dataclasses import dataclass, replace
from datetime import datetime, timezone

from src.core.errors import AuthorizationError, BadRequestError, ResourceNotFoundError
from src.domain import AdminActionAudit
from src.domain.admin_config import AdminMenuConfigItem, AdminMenuConfigSnapshot
from src.domain.enums import AuditResultStatus
from src.services.admin_config.menu_tree import (
    MENU_NODE_CATEGORY,
    MENU_NODE_PANEL,
    MENU_NODE_PAGE,
    OPS_CONTROLS_DESCRIPTION,
    OPS_CONTROLS_LABEL,
    build_default_menu_items,
)
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore


MENU_CONFIG_KEY = "admin_menu_config"
OWNER_READ_PERMISSION = "owner:read"
DEFAULT_MENU_MIGRATION_ITEM_IDS = {
    "analytics",
    "dashboard-analytics",
    "analytics-consumer-funnel",
    "analytics-invocation-revenue",
    "analytics-provider-revenue",
    "analytics-money-flow",
    "analytics-risk-health",
    "analytics-data-quality",
    "provider-services",
    "provider-llm-config",
    "owner-accounts",
    "review-history",
    "forum-support",
}
DEFAULT_MENU_FIELD_MIGRATION_ITEM_IDS = {
    "permissions-matrix",
    "module-boundaries",
    "reviewer-split",
    "config-center",
}
DRAFT_READ_ROLES = {"super_admin", "platform_ops_admin"}
WRITE_ROLES = {"super_admin"}


@dataclass(frozen=True)
class AdminMenuConfigSerializedSnapshot:
    items: tuple[dict, ...]
    meta: dict


def _serialize_timestamp(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _owner_accounts_menu_item() -> AdminMenuConfigItem:
    return AdminMenuConfigItem(
        item_id="owner-accounts",
        section_id="ops-controls",
        section_label=OPS_CONTROLS_LABEL,
        section_description=OPS_CONTROLS_DESCRIPTION,
        label="业务用户",
        href="/owner-accounts",
        description="查询 consumer/provider owner、钱包、邮箱验证和运营关联摘要。",
        parent_item_id="business-control",
        node_type=MENU_NODE_PAGE,
        icon_key="OA",
        required_permissions=(OWNER_READ_PERMISSION,),
        sort_order=228,
        keywords=("owner", "accounts", "wallet", "email", "consumer", "provider"),
    )


def _default_menu_items() -> tuple[AdminMenuConfigItem, ...]:
    return (*build_default_menu_items(), _owner_accounts_menu_item())


class AdminConfigService:
    def __init__(self, store: AdminStore) -> None:
        self._store = store

    def list_menu_items(
        self, operator: AdminIdentity, stage: str = "draft"
    ) -> AdminMenuConfigSerializedSnapshot:
        normalized_stage = stage.strip().lower() if stage else "draft"
        if normalized_stage not in {"draft", "published"}:
            raise BadRequestError("Unsupported config stage")
        self._ensure_role(operator, DRAFT_READ_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        items = snapshot.draft_items if normalized_stage == "draft" else snapshot.published_items
        return self._serialize_snapshot(snapshot, items)

    def list_visible_menu_items(
        self, operator: AdminIdentity
    ) -> AdminMenuConfigSerializedSnapshot:
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        return self._serialize_snapshot(snapshot, self._filter_visible_items(snapshot.published_items, operator))

    def create_menu_item(
        self, operator: AdminIdentity, payload: dict
    ) -> AdminMenuConfigSerializedSnapshot:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        item = self._build_item(payload, fallback_sort_order=len(snapshot.draft_items) + 1)
        self._validate_parent(snapshot.draft_items, item)
        if any(existing.item_id == item.item_id for existing in snapshot.draft_items):
            raise BadRequestError("Menu item id already exists")
        if item.href and any(existing.href == item.href for existing in snapshot.draft_items):
            raise BadRequestError("Menu href already exists")
        now = datetime.now(timezone.utc)
        saved = self._save_snapshot(replace(snapshot, draft_items=self._sort_items((*snapshot.draft_items, item)), draft_version=snapshot.draft_version + 1, updated_at=now, updated_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.create_item", {}, self._serialize_item(item))
        return self._serialize_snapshot(saved, saved.draft_items)

    def update_menu_item(
        self, operator: AdminIdentity, item_id: str, payload: dict
    ) -> AdminMenuConfigSerializedSnapshot:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        current = next((item for item in snapshot.draft_items if item.item_id == item_id), None)
        if current is None:
            raise ResourceNotFoundError("Menu item does not exist")
        next_item = self._build_item(payload, fallback_sort_order=current.sort_order, item_id=item_id)
        self._validate_parent(snapshot.draft_items, next_item)
        for existing in snapshot.draft_items:
            if next_item.href and existing.item_id != item_id and existing.href == next_item.href:
                raise BadRequestError("Menu href already exists")
        now = datetime.now(timezone.utc)
        updated_items = self._sort_items(tuple(next_item if item.item_id == item_id else item for item in snapshot.draft_items))
        saved = self._save_snapshot(replace(snapshot, draft_items=updated_items, draft_version=snapshot.draft_version + 1, updated_at=now, updated_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.update_item", self._serialize_item(current), self._serialize_item(next_item))
        return self._serialize_snapshot(saved, saved.draft_items)

    def delete_menu_item(
        self, operator: AdminIdentity, item_id: str
    ) -> AdminMenuConfigSerializedSnapshot:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        current = next((item for item in snapshot.draft_items if item.item_id == item_id), None)
        if current is None:
            raise ResourceNotFoundError("Menu item does not exist")
        deleted_item_ids = self._collect_descendant_ids(snapshot.draft_items, item_id)
        now = datetime.now(timezone.utc)
        saved = self._save_snapshot(replace(snapshot, draft_items=tuple(item for item in snapshot.draft_items if item.item_id not in deleted_item_ids), draft_version=snapshot.draft_version + 1, updated_at=now, updated_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.delete_item", {"deletedItems": [self._serialize_item(item) for item in snapshot.draft_items if item.item_id in deleted_item_ids]}, {})
        return self._serialize_snapshot(saved, saved.draft_items)

    def publish_menu_config(
        self, operator: AdminIdentity
    ) -> AdminMenuConfigSerializedSnapshot:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        now = datetime.now(timezone.utc)
        saved = self._save_snapshot(replace(snapshot, published_items=snapshot.draft_items, published_version=snapshot.draft_version, updated_at=now, updated_by=operator.admin_id, published_at=now, published_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.publish", {"publishedVersion": snapshot.published_version}, {"publishedVersion": saved.published_version})
        return self._serialize_snapshot(saved, saved.published_items)

    def _get_or_create_snapshot(self, operator_id: str | None) -> AdminMenuConfigSnapshot:
        snapshot = self._store.config.get_menu_config(MENU_CONFIG_KEY)
        if snapshot is not None:
            return self._merge_missing_default_items(snapshot, operator_id)
        now = datetime.now(timezone.utc)
        items = self._sort_items(_default_menu_items())
        return self._save_snapshot(AdminMenuConfigSnapshot(config_key=MENU_CONFIG_KEY, draft_items=items, published_items=items, draft_version=1, published_version=1, created_at=now, updated_at=now, updated_by=operator_id or "system_seed", published_at=now, published_by=operator_id or "system_seed"))

    def _save_snapshot(self, snapshot: AdminMenuConfigSnapshot) -> AdminMenuConfigSnapshot:
        return self._store.config.save_menu_config(snapshot)

    def _merge_missing_default_items(
        self, snapshot: AdminMenuConfigSnapshot, operator_id: str | None
    ) -> AdminMenuConfigSnapshot:
        default_items_by_id = {item.item_id: item for item in _default_menu_items()}
        draft_item_ids = {item.item_id for item in snapshot.draft_items}
        published_item_ids = {item.item_id for item in snapshot.published_items}

        draft_additions = self._missing_default_items(
            default_items_by_id, draft_item_ids
        )
        published_additions = self._missing_default_items(
            default_items_by_id, published_item_ids
        )
        draft_items, draft_patched = self._patch_default_item_fields(
            (*snapshot.draft_items, *draft_additions), default_items_by_id
        )
        published_items, published_patched = self._patch_default_item_fields(
            (*snapshot.published_items, *published_additions), default_items_by_id
        )

        if (
            not draft_additions
            and not published_additions
            and not draft_patched
            and not published_patched
        ):
            return snapshot

        now = datetime.now(timezone.utc)
        actor_id = (
            operator_id or snapshot.updated_by or snapshot.published_by or "system_seed"
        )
        draft_version_delta = 1 if draft_additions or draft_patched else 0
        published_version_delta = (
            1 if published_additions or published_patched else 0
        )
        return self._save_snapshot(
            replace(
                snapshot,
                draft_items=self._sort_items(draft_items),
                published_items=self._sort_items(published_items),
                draft_version=snapshot.draft_version + draft_version_delta,
                published_version=snapshot.published_version + published_version_delta,
                updated_at=now,
                updated_by=actor_id,
                published_at=(
                    now
                    if published_additions or published_patched
                    else snapshot.published_at
                ),
                published_by=(
                    actor_id
                    if published_additions or published_patched
                    else snapshot.published_by
                ),
            )
        )

    @staticmethod
    def _missing_default_items(
        default_items_by_id: dict[str, AdminMenuConfigItem],
        existing_item_ids: set[str],
    ) -> tuple[AdminMenuConfigItem, ...]:
        return tuple(
            default_items_by_id[item_id]
            for item_id in DEFAULT_MENU_MIGRATION_ITEM_IDS
            if item_id in default_items_by_id and item_id not in existing_item_ids
        )

    @staticmethod
    def _patch_default_item_fields(
        items: tuple[AdminMenuConfigItem, ...],
        default_items_by_id: dict[str, AdminMenuConfigItem],
    ) -> tuple[tuple[AdminMenuConfigItem, ...], bool]:
        changed = False
        patched_items: list[AdminMenuConfigItem] = []
        for item in items:
            default_item = default_items_by_id.get(item.item_id)
            if (
                item.item_id in DEFAULT_MENU_FIELD_MIGRATION_ITEM_IDS
                and default_item is not None
                and (
                    item.href != default_item.href
                    or item.node_type != default_item.node_type
                )
            ):
                patched_items.append(
                    replace(
                        item,
                        href=default_item.href,
                        node_type=default_item.node_type,
                    )
                )
                changed = True
            else:
                patched_items.append(item)
        return tuple(patched_items), changed

    def _serialize_snapshot(
        self,
        snapshot: AdminMenuConfigSnapshot,
        items: tuple[AdminMenuConfigItem, ...],
    ) -> AdminMenuConfigSerializedSnapshot:
        return AdminMenuConfigSerializedSnapshot(
            items=tuple(self._serialize_item(item) for item in items),
            meta={
                "draftVersion": snapshot.draft_version,
                "publishedVersion": snapshot.published_version,
                "isDirty": snapshot.draft_version != snapshot.published_version,
                "updatedAt": _serialize_timestamp(snapshot.updated_at),
                "publishedAt": _serialize_timestamp(snapshot.published_at),
                "updatedBy": snapshot.updated_by,
                "publishedBy": snapshot.published_by,
            },
        )

    @staticmethod
    def _filter_visible_items(items: tuple[AdminMenuConfigItem, ...], operator: AdminIdentity) -> tuple[AdminMenuConfigItem, ...]:
        if operator.role == "super_admin":
            return items
        permissions = set(operator.permissions)
        children_by_parent = AdminConfigService._group_children_by_parent(items)

        visible_items: list[AdminMenuConfigItem] = []
        for root_item in children_by_parent.get(None, []):
            visible_items.extend(
                AdminConfigService._flatten_visible_branch(
                    root_item,
                    children_by_parent,
                    operator.role,
                    permissions,
                    True,
                )
            )
        return tuple(visible_items)

    @staticmethod
    def _sort_items(items: tuple[AdminMenuConfigItem, ...] | list[AdminMenuConfigItem]) -> tuple[AdminMenuConfigItem, ...]:
        return tuple(sorted(items, key=lambda item: (item.sort_order, item.parent_item_id or "", item.section_id, item.href or "", item.item_id)))

    @staticmethod
    def _validate_parent(items: tuple[AdminMenuConfigItem, ...], candidate: AdminMenuConfigItem) -> None:
        if candidate.parent_item_id is None:
            return
        items_by_id = {item.item_id: item for item in items}
        parent = items_by_id.get(candidate.parent_item_id)
        if parent is None:
            raise BadRequestError("Parent menu item does not exist")
        cursor: AdminMenuConfigItem | None = parent
        while cursor is not None:
            if cursor.item_id == candidate.item_id:
                raise BadRequestError("Menu tree cannot contain cycles")
            cursor = items_by_id.get(cursor.parent_item_id) if cursor.parent_item_id else None

    @staticmethod
    def _collect_descendant_ids(items: tuple[AdminMenuConfigItem, ...], root_item_id: str) -> set[str]:
        children_by_parent = AdminConfigService._group_children_by_parent(items)

        descendant_ids: set[str] = set()

        def visit(item_id: str) -> None:
            descendant_ids.add(item_id)
            for child in children_by_parent.get(item_id, []):
                visit(child.item_id)

        visit(root_item_id)
        return descendant_ids

    @staticmethod
    def _group_children_by_parent(items: tuple[AdminMenuConfigItem, ...]) -> dict[str | None, list[AdminMenuConfigItem]]:
        children_by_parent: dict[str | None, list[AdminMenuConfigItem]] = {}
        for item in items:
            children_by_parent.setdefault(item.parent_item_id, []).append(item)
        for child_items in children_by_parent.values():
            child_items.sort(key=lambda item: (item.sort_order, item.section_id, item.href or "", item.item_id))
        return children_by_parent

    @staticmethod
    def _passes_gate(item: AdminMenuConfigItem, operator_role: str, permissions: set[str]) -> bool:
        if item.required_roles and operator_role not in item.required_roles:
            return False
        return not (
            item.required_permissions
            and not all(permission in permissions for permission in item.required_permissions)
        )

    @staticmethod
    def _flatten_visible_branch(
        item: AdminMenuConfigItem,
        children_by_parent: dict[str | None, list[AdminMenuConfigItem]],
        operator_role: str,
        permissions: set[str],
        ancestor_visible: bool,
    ) -> list[AdminMenuConfigItem]:
        direct_visible = ancestor_visible and AdminConfigService._passes_gate(item, operator_role, permissions)
        child_items = children_by_parent.get(item.item_id, [])
        visible_children: list[AdminMenuConfigItem] = []

        for child in child_items:
            visible_children.extend(
                AdminConfigService._flatten_visible_branch(
                    child,
                    children_by_parent,
                    operator_role,
                    permissions,
                    direct_visible if item.node_type == MENU_NODE_CATEGORY else True,
                )
            )

        if item.node_type == MENU_NODE_CATEGORY:
            return [item, *visible_children] if direct_visible and visible_children else []
        if not direct_visible:
            return []
        return [item, *visible_children]

    @staticmethod
    def _serialize_item(item: AdminMenuConfigItem) -> dict:
        return {
            "itemId": item.item_id,
            "sectionId": item.section_id,
            "sectionLabel": item.section_label,
            "sectionDescription": item.section_description,
            "label": item.label,
            "href": item.href,
            "description": item.description,
            "parentItemId": item.parent_item_id,
            "nodeType": item.node_type,
            "iconKey": item.icon_key,
            "requiredRoles": list(item.required_roles),
            "requiredPermissions": list(item.required_permissions),
            "sortOrder": item.sort_order,
            "keywords": list(item.keywords),
        }

    @staticmethod
    def _build_item(payload: dict, fallback_sort_order: int, item_id: str | None = None) -> AdminMenuConfigItem:
        resolved_item_id = (item_id or payload.get("itemId") or "").strip()
        if not resolved_item_id:
            raise BadRequestError("Menu item id is required")
        section_id = str(payload.get("sectionId") or "").strip()
        section_label = str(payload.get("sectionLabel") or "").strip()
        label = str(payload.get("label") or "").strip()
        if not section_id or not section_label or not label:
            raise BadRequestError("Menu item section and label are required")
        node_type = AdminConfigService._normalize_node_type(payload)
        href = AdminConfigService._normalize_href(payload, node_type)
        parent_item_id = AdminConfigService._normalize_parent_item_id(payload, resolved_item_id)
        icon_key = AdminConfigService._normalize_icon_key(payload, resolved_item_id)
        if parent_item_id == resolved_item_id:
            raise BadRequestError("Menu item cannot be its own parent")
        return AdminMenuConfigItem(
            item_id=resolved_item_id,
            section_id=section_id,
            section_label=section_label,
            section_description=str(payload.get("sectionDescription") or "").strip(),
            label=label,
            href=href,
            description=str(payload.get("description") or "").strip(),
            parent_item_id=parent_item_id,
            node_type=node_type,
            icon_key=icon_key,
            required_roles=tuple(AdminConfigService._parse_list(payload.get("requiredRoles", []))),
            required_permissions=tuple(AdminConfigService._parse_list(payload.get("requiredPermissions", []))),
            sort_order=int(payload.get("sortOrder") or fallback_sort_order),
            keywords=tuple(AdminConfigService._parse_list(payload.get("keywords", []))),
        )

    @staticmethod
    def _normalize_node_type(payload: dict) -> str:
        node_type = str(payload.get("nodeType") or MENU_NODE_PAGE).strip().lower()
        if node_type not in {MENU_NODE_CATEGORY, MENU_NODE_PAGE, MENU_NODE_PANEL}:
            raise BadRequestError("Unsupported menu node type")
        return node_type

    @staticmethod
    def _normalize_href(payload: dict, node_type: str) -> str | None:
        href_raw = payload.get("href")
        href = str(href_raw).strip() if href_raw else None
        if node_type == MENU_NODE_PAGE and (href is None or not href.startswith("/")):
            raise BadRequestError("Page node href must start with /")
        return href

    @staticmethod
    def _normalize_parent_item_id(payload: dict, resolved_item_id: str) -> str | None:
        parent_item_id = str(payload.get("parentItemId") or "").strip() or None
        if parent_item_id == resolved_item_id:
            raise BadRequestError("Menu item cannot be its own parent")
        return parent_item_id

    @staticmethod
    def _normalize_icon_key(payload: dict, resolved_item_id: str) -> str:
        icon_key = str(payload.get("iconKey") or resolved_item_id[:2].upper()).strip()
        return icon_key or "SN"

    @staticmethod
    def _parse_list(raw_value: list[str] | tuple[str, ...] | str) -> list[str]:
        if isinstance(raw_value, str):
            return [item.strip() for item in raw_value.split(",") if item.strip()]
        return [str(item).strip() for item in raw_value if str(item).strip()]

    def _append_audit(self, operator: AdminIdentity, action_type: str, before: dict, after: dict) -> None:
        self._store.audit.append_action(AdminActionAudit(action_type=action_type, result_status=AuditResultStatus.SUCCESS, operator_id=operator.admin_id, operator_email=operator.email, operator_role=operator.role, resource_type="admin_menu_config", resource_id=MENU_CONFIG_KEY, before=before, after=after, created_at=datetime.now(timezone.utc)))

    @staticmethod
    def _ensure_role(operator: AdminIdentity, allowed_roles: set[str]) -> None:
        if operator.role not in allowed_roles:
            raise AuthorizationError("Admin role is not allowed to manage menu config")
