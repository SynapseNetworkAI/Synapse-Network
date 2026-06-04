from src.domain.admin_config import AdminMenuConfigItem


MENU_NODE_PAGE = "page"


def build_finance_menu_items(
    section_label: str,
    section_description: str,
    dashboard_read_permission: str,
) -> tuple[AdminMenuConfigItem, ...]:
    return (
        AdminMenuConfigItem(
            item_id="finance",
            section_id="ops-controls",
            section_label=section_label,
            section_description=section_description,
            label="资金运营",
            href="/finance",
            description="充值异常、退款与提现控制面，聚焦受控动作。",
            parent_item_id="business-control",
            node_type=MENU_NODE_PAGE,
            icon_key="FN",
            required_permissions=(dashboard_read_permission,),
            sort_order=230,
        ),
        AdminMenuConfigItem(
            item_id="finance-reconciliation",
            section_id="ops-controls",
            section_label=section_label,
            section_description=section_description,
            label="对账调查",
            href="/finance/reconciliation",
            description="资金偏差、异常队列和 drilldown 证据调查页。",
            parent_item_id="finance",
            node_type=MENU_NODE_PAGE,
            icon_key="RC",
            required_roles=("super_admin", "platform_ops_admin"),
            sort_order=231,
            keywords=("finance", "reconciliation", "drift", "ledger"),
        ),
    )
