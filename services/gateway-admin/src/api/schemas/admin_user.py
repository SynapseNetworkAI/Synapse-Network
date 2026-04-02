from pydantic import BaseModel, Field


class AdminUserSummary(BaseModel):
    admin_id: str = Field(alias="adminId", serialization_alias="adminId")
    email: str
    display_name: str = Field(alias="displayName", serialization_alias="displayName")
    status: str
    auth_source: str = Field(alias="authSource", serialization_alias="authSource")
    require_mfa: bool = Field(alias="requireMfa", serialization_alias="requireMfa")
    last_login_at: str | None = Field(default=None, alias="lastLoginAt", serialization_alias="lastLoginAt")
    created_at: str | None = Field(default=None, alias="createdAt", serialization_alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt", serialization_alias="updatedAt")
    role_keys: list[str] = Field(default_factory=list, alias="roleKeys", serialization_alias="roleKeys")
    permissions: list[str] = Field(default_factory=list)


class AdminUserListResponse(BaseModel):
    items: list[AdminUserSummary]
    next_cursor: str | None = Field(default=None, serialization_alias="nextCursor")


class AdminRoleCatalogItem(BaseModel):
    role_key: str = Field(alias="roleKey", serialization_alias="roleKey")
    role_name: str = Field(alias="roleName", serialization_alias="roleName")
    description: str | None = None
    status: str
    permissions: list[str]


class AdminPermissionCatalogItem(BaseModel):
    permission_key: str = Field(alias="permissionKey", serialization_alias="permissionKey")
    resource_domain: str = Field(alias="resourceDomain", serialization_alias="resourceDomain")
    action: str
    risk_level: str = Field(alias="riskLevel", serialization_alias="riskLevel")
    description: str | None = None


class AdminPermissionCatalogResponse(BaseModel):
    items: list[AdminPermissionCatalogItem]


class AdminRoleCatalogResponse(BaseModel):
    items: list[AdminRoleCatalogItem]


class CreateAdminRoleRequest(BaseModel):
    role_key: str = Field(alias="roleKey")
    role_name: str = Field(alias="roleName")
    description: str | None = None
    status: str = "active"
    permissions: list[str] = Field(default_factory=list)


class UpdateAdminRoleRequest(BaseModel):
    role_name: str = Field(alias="roleName")
    description: str | None = None
    status: str
    permissions: list[str] = Field(default_factory=list)


class CreateAdminRoleResponse(BaseModel):
    role: AdminRoleCatalogItem


class UpdateAdminRoleResponse(BaseModel):
    role: AdminRoleCatalogItem


class DeleteAdminRoleResponse(BaseModel):
    role_key: str = Field(alias="roleKey", serialization_alias="roleKey")
    status: str


class CreateAdminUserRequest(BaseModel):
    email: str
    display_name: str = Field(alias="displayName")
    role_key: str = Field(alias="roleKey")
    password: str
    require_mfa: bool = Field(default=False, alias="requireMfa")
    status: str = "active"


class CreateAdminUserResponse(BaseModel):
    admin: AdminUserSummary


class UpdateAdminUserRequest(BaseModel):
    display_name: str = Field(alias="displayName")
    role_key: str = Field(alias="roleKey")
    password: str | None = None
    require_mfa: bool = Field(alias="requireMfa")
    status: str


class UpdateAdminUserResponse(BaseModel):
    admin: AdminUserSummary


class DeleteAdminUserResponse(BaseModel):
    admin_id: str = Field(alias="adminId", serialization_alias="adminId")
    status: str