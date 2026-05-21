"""Admin API routers package."""

from src.api.routers import (
    admin_auth,
    admin_config,
    admin_notifications,
    admin_users,
    approval,
    audit,
    contract_addresses,
    dashboard,
    execution,
    platform_fee_treasury,
    provider_services,
    provider_withdraw_review,
)

__all__ = [
    "admin_auth",
    "admin_config",
    "admin_notifications",
    "admin_users",
    "approval",
    "audit",
    "contract_addresses",
    "dashboard",
    "execution",
    "platform_fee_treasury",
    "provider_services",
    "provider_withdraw_review",
]
