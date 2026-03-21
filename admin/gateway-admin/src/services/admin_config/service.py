from dataclasses import replace
from datetime import datetime, timezone

from src.core.errors import AuthorizationError, BadRequestError, ResourceNotFoundError
from src.domain import AdminActionAudit
from src.domain.admin_config import AdminMenuConfigItem, AdminMenuConfigSnapshot
from src.domain.enums import AuditResultStatus
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore


MENU_CONFIG_KEY = "admin_menu_config"
DRAFT_READ_ROLES = {"super_admin", "platform_ops_admin"}
WRITE_ROLES = {"super_admin"}
IDENTITY_ACCESS_LABEL = "身份与权限"
IDENTITY_ACCESS_DESCRIPTION = "后台用户、角色模板、菜单树与权限矩阵。"
OPS_CONTROLS_LABEL = "业务控制"
OPS_CONTROLS_DESCRIPTION = "审批、资金、风控和系统运维的受控操作入口。"
DASHBOARD_READ_PERMISSION = "dashboard:read"


def _serialize_timestamp(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def _default_menu_items() -> tuple[AdminMenuConfigItem, ...]:
    return (
        AdminMenuConfigItem("dashboard", "overview", "控制总览", "稳定读模型、控制台总览与核心运营信号。", "控制台", "/dashboard", "总览 finance、activity、operations 3 个稳定读模型。", required_permissions=(DASHBOARD_READ_PERMISSION,), sort_order=10),
        AdminMenuConfigItem("users", "identity-access", IDENTITY_ACCESS_LABEL, IDENTITY_ACCESS_DESCRIPTION, "后台用户", "/users", "创建管理员、分配角色、查看权限模板与启用状态。", required_roles=("super_admin", "platform_ops_admin"), sort_order=20),
        AdminMenuConfigItem("role-permissions", "identity-access", IDENTITY_ACCESS_LABEL, IDENTITY_ACCESS_DESCRIPTION, "角色权限", "/role-permissions", "查看角色权限矩阵、模块权限边界与 reviewer 分工。", required_roles=("super_admin", "platform_ops_admin"), sort_order=30),
        AdminMenuConfigItem("menu-config", "identity-access", IDENTITY_ACCESS_LABEL, IDENTITY_ACCESS_DESCRIPTION, "菜单配置", "/menu-config", "菜单树、路由、可见性和权限依赖的配置视图。", required_roles=("super_admin", "platform_ops_admin"), sort_order=40),
        AdminMenuConfigItem("execution", "identity-access", IDENTITY_ACCESS_LABEL, IDENTITY_ACCESS_DESCRIPTION, "执行队列", "/execution", "查看 execution jobs、失败重试与网关执行结果。", required_permissions=("execution:read",), sort_order=50),
        AdminMenuConfigItem("approvals", "ops-controls", OPS_CONTROLS_LABEL, OPS_CONTROLS_DESCRIPTION, "审批中心", "/approvals", "高风险动作审批流、reviewer 决策与执行前守门。", required_permissions=("approval:read",), sort_order=60),
        AdminMenuConfigItem("withdrawal-reviews", "ops-controls", OPS_CONTROLS_LABEL, OPS_CONTROLS_DESCRIPTION, "提现审核", "/withdrawal-reviews", "Provider 提现人工审核工作台，直接推进 approve / reject。", required_permissions=("approval:read",), sort_order=65),
        AdminMenuConfigItem("finance", "ops-controls", OPS_CONTROLS_LABEL, OPS_CONTROLS_DESCRIPTION, "资金运营", "/finance", "充值异常、退款与提现控制面，聚焦受控动作。", required_permissions=(DASHBOARD_READ_PERMISSION,), sort_order=70),
        AdminMenuConfigItem("risk", "ops-controls", OPS_CONTROLS_LABEL, OPS_CONTROLS_DESCRIPTION, "风控工作台", "/risk", "风险规则、工单分流、黑白名单与风险标签处置。", required_permissions=(DASHBOARD_READ_PERMISSION,), sort_order=80),
        AdminMenuConfigItem("system", "ops-controls", OPS_CONTROLS_LABEL, OPS_CONTROLS_DESCRIPTION, "系统运维", "/system", "gateway、indexer、reconciliation 与运行时参数快照。", required_permissions=(DASHBOARD_READ_PERMISSION,), sort_order=90),
        AdminMenuConfigItem("audit", "audit-ledger", "审计合规", "操作日志、审计回放与高风险动作追踪。", "操作日志", "/audit", "管理员操作日志、审批链路和失败告警审计检索。", required_permissions=("audit:read",), sort_order=100),
    )


class AdminConfigService:
    def __init__(self, store: AdminStore) -> None:
        self._store = store

    def list_menu_items(self, operator: AdminIdentity, stage: str = "draft") -> dict:
        normalized_stage = stage.strip().lower() if stage else "draft"
        if normalized_stage not in {"draft", "published"}:
            raise BadRequestError("Unsupported config stage")
        self._ensure_role(operator, DRAFT_READ_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        items = snapshot.draft_items if normalized_stage == "draft" else snapshot.published_items
        return self._serialize_snapshot(snapshot, items)

    def list_visible_menu_items(self, operator: AdminIdentity) -> dict:
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        return self._serialize_snapshot(snapshot, self._filter_visible_items(snapshot.published_items, operator))

    def create_menu_item(self, operator: AdminIdentity, payload: dict) -> dict:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        item = self._build_item(payload, fallback_sort_order=len(snapshot.draft_items) + 1)
        if any(existing.item_id == item.item_id for existing in snapshot.draft_items):
            raise BadRequestError("Menu item id already exists")
        if any(existing.href == item.href for existing in snapshot.draft_items):
            raise BadRequestError("Menu href already exists")
        now = datetime.now(timezone.utc)
        saved = self._save_snapshot(replace(snapshot, draft_items=self._sort_items((*snapshot.draft_items, item)), draft_version=snapshot.draft_version + 1, updated_at=now, updated_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.create_item", {}, self._serialize_item(item))
        return self._serialize_snapshot(saved, saved.draft_items)

    def update_menu_item(self, operator: AdminIdentity, item_id: str, payload: dict) -> dict:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        current = next((item for item in snapshot.draft_items if item.item_id == item_id), None)
        if current is None:
            raise ResourceNotFoundError("Menu item does not exist")
        next_item = self._build_item(payload, fallback_sort_order=current.sort_order, item_id=item_id)
        for existing in snapshot.draft_items:
            if existing.item_id != item_id and existing.href == next_item.href:
                raise BadRequestError("Menu href already exists")
        now = datetime.now(timezone.utc)
        updated_items = self._sort_items(tuple(next_item if item.item_id == item_id else item for item in snapshot.draft_items))
        saved = self._save_snapshot(replace(snapshot, draft_items=updated_items, draft_version=snapshot.draft_version + 1, updated_at=now, updated_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.update_item", self._serialize_item(current), self._serialize_item(next_item))
        return self._serialize_snapshot(saved, saved.draft_items)

    def delete_menu_item(self, operator: AdminIdentity, item_id: str) -> dict:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        current = next((item for item in snapshot.draft_items if item.item_id == item_id), None)
        if current is None:
            raise ResourceNotFoundError("Menu item does not exist")
        now = datetime.now(timezone.utc)
        saved = self._save_snapshot(replace(snapshot, draft_items=tuple(item for item in snapshot.draft_items if item.item_id != item_id), draft_version=snapshot.draft_version + 1, updated_at=now, updated_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.delete_item", self._serialize_item(current), {})
        return self._serialize_snapshot(saved, saved.draft_items)

    def publish_menu_config(self, operator: AdminIdentity) -> dict:
        self._ensure_role(operator, WRITE_ROLES)
        snapshot = self._get_or_create_snapshot(operator.admin_id)
        now = datetime.now(timezone.utc)
        saved = self._save_snapshot(replace(snapshot, published_items=snapshot.draft_items, published_version=snapshot.draft_version, updated_at=now, updated_by=operator.admin_id, published_at=now, published_by=operator.admin_id))
        self._append_audit(operator, "admin_menu_config.publish", {"publishedVersion": snapshot.published_version}, {"publishedVersion": saved.published_version})
        return self._serialize_snapshot(saved, saved.published_items)

    def _get_or_create_snapshot(self, operator_id: str | None) -> AdminMenuConfigSnapshot:
        snapshot = self._store.config.get_menu_config(MENU_CONFIG_KEY)
        if snapshot is not None:
            return snapshot
        now = datetime.now(timezone.utc)
        items = self._sort_items(_default_menu_items())
        return self._save_snapshot(AdminMenuConfigSnapshot(config_key=MENU_CONFIG_KEY, draft_items=items, published_items=items, draft_version=1, published_version=1, created_at=now, updated_at=now, updated_by=operator_id or "system_seed", published_at=now, published_by=operator_id or "system_seed"))

    def _save_snapshot(self, snapshot: AdminMenuConfigSnapshot) -> AdminMenuConfigSnapshot:
        return self._store.config.save_menu_config(snapshot)

    def _serialize_snapshot(self, snapshot: AdminMenuConfigSnapshot, items: tuple[AdminMenuConfigItem, ...]) -> dict:
        return {
            "items": [self._serialize_item(item) for item in items],
            "meta": {
                "draftVersion": snapshot.draft_version,
                "publishedVersion": snapshot.published_version,
                "isDirty": snapshot.draft_version != snapshot.published_version,
                "updatedAt": _serialize_timestamp(snapshot.updated_at),
                "publishedAt": _serialize_timestamp(snapshot.published_at),
                "updatedBy": snapshot.updated_by,
                "publishedBy": snapshot.published_by,
            },
        }

    @staticmethod
    def _filter_visible_items(items: tuple[AdminMenuConfigItem, ...], operator: AdminIdentity) -> tuple[AdminMenuConfigItem, ...]:
        if operator.role == "super_admin":
            return items
        permissions = set(operator.permissions)
        visible_items: list[AdminMenuConfigItem] = []
        for item in items:
            if item.required_roles and operator.role not in item.required_roles:
                continue
            if item.required_permissions and not all(permission in permissions for permission in item.required_permissions):
                continue
            visible_items.append(item)
        return tuple(visible_items)

    @staticmethod
    def _sort_items(items: tuple[AdminMenuConfigItem, ...] | list[AdminMenuConfigItem]) -> tuple[AdminMenuConfigItem, ...]:
        return tuple(sorted(items, key=lambda item: (item.sort_order, item.section_id, item.href, item.item_id)))

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
            "requiredRoles": list(item.required_roles),
            "requiredPermissions": list(item.required_permissions),
            "sortOrder": item.sort_order,
        }

    @staticmethod
    def _build_item(payload: dict, fallback_sort_order: int, item_id: str | None = None) -> AdminMenuConfigItem:
        resolved_item_id = (item_id or payload.get("itemId") or "").strip()
        if not resolved_item_id:
            raise BadRequestError("Menu item id is required")
        href = str(payload.get("href") or "").strip()
        if not href.startswith("/"):
            raise BadRequestError("Menu href must start with /")
        section_id = str(payload.get("sectionId") or "").strip()
        section_label = str(payload.get("sectionLabel") or "").strip()
        label = str(payload.get("label") or "").strip()
        if not section_id or not section_label or not label:
            raise BadRequestError("Menu item section and label are required")
        return AdminMenuConfigItem(
            item_id=resolved_item_id,
            section_id=section_id,
            section_label=section_label,
            section_description=str(payload.get("sectionDescription") or "").strip(),
            label=label,
            href=href,
            description=str(payload.get("description") or "").strip(),
            required_roles=tuple(AdminConfigService._parse_list(payload.get("requiredRoles", []))),
            required_permissions=tuple(AdminConfigService._parse_list(payload.get("requiredPermissions", []))),
            sort_order=int(payload.get("sortOrder") or fallback_sort_order),
        )

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