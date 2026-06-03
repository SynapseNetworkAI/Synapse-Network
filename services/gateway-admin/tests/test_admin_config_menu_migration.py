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
