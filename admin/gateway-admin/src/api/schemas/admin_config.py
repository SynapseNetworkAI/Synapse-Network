from pydantic import BaseModel, Field


class AdminMenuConfigItemModel(BaseModel):
    item_id: str = Field(alias="itemId", serialization_alias="itemId")
    section_id: str = Field(alias="sectionId", serialization_alias="sectionId")
    section_label: str = Field(alias="sectionLabel", serialization_alias="sectionLabel")
    section_description: str = Field(alias="sectionDescription", serialization_alias="sectionDescription")
    label: str
    href: str | None = None
    description: str
    parent_item_id: str | None = Field(default=None, alias="parentItemId", serialization_alias="parentItemId")
    node_type: str = Field(default="page", alias="nodeType", serialization_alias="nodeType")
    icon_key: str = Field(default="SN", alias="iconKey", serialization_alias="iconKey")
    required_roles: list[str] = Field(default_factory=list, alias="requiredRoles", serialization_alias="requiredRoles")
    required_permissions: list[str] = Field(default_factory=list, alias="requiredPermissions", serialization_alias="requiredPermissions")
    sort_order: int = Field(alias="sortOrder", serialization_alias="sortOrder")
    keywords: list[str] = Field(default_factory=list, alias="keywords", serialization_alias="keywords")


class AdminMenuConfigMetaModel(BaseModel):
    draft_version: int = Field(alias="draftVersion", serialization_alias="draftVersion")
    published_version: int = Field(alias="publishedVersion", serialization_alias="publishedVersion")
    is_dirty: bool = Field(alias="isDirty", serialization_alias="isDirty")
    updated_at: str | None = Field(default=None, alias="updatedAt", serialization_alias="updatedAt")
    published_at: str | None = Field(default=None, alias="publishedAt", serialization_alias="publishedAt")
    updated_by: str | None = Field(default=None, alias="updatedBy", serialization_alias="updatedBy")
    published_by: str | None = Field(default=None, alias="publishedBy", serialization_alias="publishedBy")


class AdminMenuConfigResponse(BaseModel):
    items: list[AdminMenuConfigItemModel]
    meta: AdminMenuConfigMetaModel


class CreateAdminMenuConfigItemRequest(BaseModel):
    item_id: str = Field(alias="itemId")
    section_id: str = Field(alias="sectionId")
    section_label: str = Field(alias="sectionLabel")
    section_description: str = Field(alias="sectionDescription")
    label: str
    href: str | None = None
    description: str
    parent_item_id: str | None = Field(default=None, alias="parentItemId")
    node_type: str = Field(default="page", alias="nodeType")
    icon_key: str | None = Field(default=None, alias="iconKey")
    required_roles: list[str] = Field(default_factory=list, alias="requiredRoles")
    required_permissions: list[str] = Field(default_factory=list, alias="requiredPermissions")
    sort_order: int | None = Field(default=None, alias="sortOrder")
    keywords: list[str] = Field(default_factory=list, alias="keywords")


class UpdateAdminMenuConfigItemRequest(BaseModel):
    section_id: str = Field(alias="sectionId")
    section_label: str = Field(alias="sectionLabel")
    section_description: str = Field(alias="sectionDescription")
    label: str
    href: str | None = None
    description: str
    parent_item_id: str | None = Field(default=None, alias="parentItemId")
    node_type: str = Field(default="page", alias="nodeType")
    icon_key: str | None = Field(default=None, alias="iconKey")
    required_roles: list[str] = Field(default_factory=list, alias="requiredRoles")
    required_permissions: list[str] = Field(default_factory=list, alias="requiredPermissions")
    sort_order: int | None = Field(default=None, alias="sortOrder")
    keywords: list[str] = Field(default_factory=list, alias="keywords")