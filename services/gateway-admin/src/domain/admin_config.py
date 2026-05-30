from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True, frozen=True)
class AdminMenuConfigItem:
    item_id: str
    section_id: str
    section_label: str
    section_description: str
    label: str
    href: str | None
    description: str
    parent_item_id: str | None = None
    node_type: str = "page"
    icon_key: str = "SN"
    required_roles: tuple[str, ...] = field(default_factory=tuple)
    required_permissions: tuple[str, ...] = field(default_factory=tuple)
    sort_order: int = 0
    keywords: tuple[str, ...] = field(default_factory=tuple)


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


@dataclass(slots=True, frozen=True)
class AdminDocumentConfigSnapshot:
    config_key: str
    draft_payload: dict[str, Any] = field(default_factory=dict)
    published_payload: dict[str, Any] = field(default_factory=dict)
    draft_version: int = 1
    published_version: int = 1
    created_at: datetime | None = None
    updated_at: datetime | None = None
    updated_by: str | None = None
    published_at: datetime | None = None
    published_by: str | None = None
