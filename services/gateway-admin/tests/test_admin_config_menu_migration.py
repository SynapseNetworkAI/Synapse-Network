from dataclasses import replace

from src.services.admin_config.service import AdminConfigService
from src.services.auth.service import AdminIdentity
from src.storage import InMemoryAdminStore


def _super_admin() -> AdminIdentity:
    return AdminIdentity(
        admin_id="adm_super_admin",
        email="cliff@synapse-network.ai",
        display_name="Cliff",
        role="super_admin",
        permissions=(),
    )


def _visible_items_by_id(store: InMemoryAdminStore) -> dict[str, dict]:
    service = AdminConfigService(store)
    response = service.list_visible_menu_items(_super_admin())
    return {item["itemId"]: item for item in response.items}


CONFIG_ENTRY_IDS = {
    "config-center",
    "business-policy-config",
    "runtime-config",
    "published-config",
}
FINANCE_ENTRY_IDS = {
    "finance-reconciliation",
}
DASHBOARD_ENTRY_IDS = {
    "dashboard",
    "dashboard-overview",
    "dashboard-runtime",
    "dashboard-system-health",
}


def test_menu_snapshot_backfills_config_center_when_seed_item_is_missing() -> None:
    store = InMemoryAdminStore.seed_demo()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    trimmed_snapshot = replace(
        snapshot,
        draft_items=tuple(
            item
            for item in snapshot.draft_items
            if item.item_id not in CONFIG_ENTRY_IDS
        ),
        published_items=tuple(
            item
            for item in snapshot.published_items
            if item.item_id not in CONFIG_ENTRY_IDS
        ),
    )
    store.config.save_menu_config(trimmed_snapshot)

    visible_by_id = _visible_items_by_id(store)

    assert visible_by_id["config-center"]["href"] == "/config"
    assert visible_by_id["config-center"]["parentItemId"] == "business-control"
    assert visible_by_id["config-center"]["label"] == "配置中心"
    assert visible_by_id["business-policy-config"]["href"] == "/config/business-policy"
    assert visible_by_id["business-policy-config"]["parentItemId"] == "config-center"
    assert visible_by_id["runtime-config"]["href"] == "/config/runtime"
    assert visible_by_id["published-config"]["href"] == "/config/published"


def test_menu_snapshot_patches_stale_config_center_route() -> None:
    store = InMemoryAdminStore.seed_demo()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    stale_snapshot = replace(
        snapshot,
        draft_items=tuple(
            replace(item, href=None)
            if item.item_id == "config-center"
            else item
            for item in snapshot.draft_items
        ),
        published_items=tuple(
            replace(item, href=None)
            if item.item_id == "config-center"
            else item
            for item in snapshot.published_items
        ),
    )
    store.config.save_menu_config(stale_snapshot)

    visible_by_id = _visible_items_by_id(store)

    assert visible_by_id["config-center"]["href"] == "/config"
    assert visible_by_id["business-policy-config"]["href"] == "/config/business-policy"
    assert visible_by_id["runtime-config"]["href"] == "/config/runtime"
    assert visible_by_id["published-config"]["href"] == "/config/published"


def test_menu_snapshot_patches_stale_dashboard_child_routes() -> None:
    store = InMemoryAdminStore.seed_demo()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    stale_snapshot = replace(
        snapshot,
        draft_items=tuple(
            replace(item, href="/dashboard", node_type="page")
            if item.item_id == "dashboard"
            else replace(item, href=None, node_type="panel")
            if item.item_id in DASHBOARD_ENTRY_IDS
            else item
            for item in snapshot.draft_items
        ),
        published_items=tuple(
            replace(item, href="/dashboard", node_type="page")
            if item.item_id == "dashboard"
            else replace(item, href=None, node_type="panel")
            if item.item_id in DASHBOARD_ENTRY_IDS
            else item
            for item in snapshot.published_items
        ),
    )
    store.config.save_menu_config(stale_snapshot)

    visible_by_id = _visible_items_by_id(store)

    assert visible_by_id["dashboard"]["href"] is None
    assert visible_by_id["dashboard"]["nodeType"] == "category"
    assert visible_by_id["dashboard-overview"]["href"] == "/dashboard/overview"
    assert visible_by_id["dashboard-overview"]["nodeType"] == "page"
    assert visible_by_id["dashboard-runtime"]["href"] == "/dashboard/runtime"
    assert visible_by_id["dashboard-runtime"]["nodeType"] == "page"
    assert visible_by_id["dashboard-system-health"]["href"] == "/dashboard/health"
    assert visible_by_id["dashboard-system-health"]["nodeType"] == "page"


def test_menu_snapshot_backfills_finance_reconciliation_entry() -> None:
    store = InMemoryAdminStore.seed_demo()
    snapshot = store.config.get_menu_config("admin_menu_config")
    assert snapshot is not None

    trimmed_snapshot = replace(
        snapshot,
        draft_items=tuple(
            item
            for item in snapshot.draft_items
            if item.item_id not in FINANCE_ENTRY_IDS
        ),
        published_items=tuple(
            item
            for item in snapshot.published_items
            if item.item_id not in FINANCE_ENTRY_IDS
        ),
    )
    store.config.save_menu_config(trimmed_snapshot)

    visible_by_id = _visible_items_by_id(store)

    assert visible_by_id["finance-reconciliation"]["href"] == "/finance/reconciliation"
    assert visible_by_id["finance-reconciliation"]["parentItemId"] == "finance"
    assert visible_by_id["finance-reconciliation"]["nodeType"] == "page"
