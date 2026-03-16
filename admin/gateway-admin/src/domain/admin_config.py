from dataclasses import dataclass, field
from datetime import datetime


@dataclass(slots=True, frozen=True)
class AdminMenuConfigItem:
    item_id: str
    section_id: str
    section_label: str
    section_description: str
    label: str
    href: str
    description: str
    required_roles: tuple[str, ...] = field(default_factory=tuple)
    required_permissions: tuple[str, ...] = field(default_factory=tuple)
    sort_order: int = 0


@dataclass(slots=True, frozen=True)
class AdminMenuConfigSnapshot:
    config_key: str
    draft_items: tuple[AdminMenuConfigItem, ...] = field(default_factory=tuple)
    published_items: tuple[AdminMenuConfigItem, ...] = field(default_factory=tuple)
    draft_version: int = 1
    published_version: int = 1
    created_at: datetime | None = None
    updated_at: datetime | None = None
    updated_by: str | None = None
    published_at: datetime | None = None
    published_by: str | None = None