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


class BusinessPolicyFinanceModel(BaseModel):
    platform_fee_rate: str = Field(alias="platformFeeRate", serialization_alias="platformFeeRate")
    gateway_routing_tax_usdc: str = Field(
        alias="gatewayRoutingTaxUsdc", serialization_alias="gatewayRoutingTaxUsdc"
    )
    consumer_withdraw_fee_usdc: str = Field(
        alias="consumerWithdrawFeeUsdc", serialization_alias="consumerWithdrawFeeUsdc"
    )
    consumer_deposit_min_usdc: str = Field(
        alias="consumerDepositMinUsdc", serialization_alias="consumerDepositMinUsdc"
    )


class BusinessPolicyConsumerWithdrawModel(BaseModel):
    min_usdc: str = Field(alias="minUsdc", serialization_alias="minUsdc")
    manual_review_threshold_usdc: str = Field(
        alias="manualReviewThresholdUsdc",
        serialization_alias="manualReviewThresholdUsdc",
    )
    max_daily_count: int = Field(alias="maxDailyCount", serialization_alias="maxDailyCount")
    maturity_seconds: int = Field(
        alias="maturitySeconds", serialization_alias="maturitySeconds"
    )


class BusinessPolicyRiskModel(BaseModel):
    withdrawal_auto_single_limit_usdc: str = Field(
        alias="withdrawalAutoSingleLimitUsdc",
        serialization_alias="withdrawalAutoSingleLimitUsdc",
    )
    withdrawal_auto_24h_limit_usdc: str = Field(
        alias="withdrawalAuto24hLimitUsdc",
        serialization_alias="withdrawalAuto24hLimitUsdc",
    )
    withdrawal_window_hours: int = Field(
        alias="withdrawalWindowHours", serialization_alias="withdrawalWindowHours"
    )


class BusinessPolicyReconciliationModel(BaseModel):
    alert_delta_usdc: str = Field(
        alias="alertDeltaUsdc", serialization_alias="alertDeltaUsdc"
    )


class BusinessPolicyPayloadModel(BaseModel):
    finance: BusinessPolicyFinanceModel
    consumer_withdraw: BusinessPolicyConsumerWithdrawModel = Field(
        alias="consumerWithdraw", serialization_alias="consumerWithdraw"
    )
    risk: BusinessPolicyRiskModel
    reconciliation: BusinessPolicyReconciliationModel


class BusinessPolicyConfigMetaModel(BaseModel):
    draft_version: int = Field(alias="draftVersion", serialization_alias="draftVersion")
    published_version: int = Field(
        alias="publishedVersion", serialization_alias="publishedVersion"
    )
    is_dirty: bool = Field(alias="isDirty", serialization_alias="isDirty")
    updated_at: str | None = Field(
        default=None, alias="updatedAt", serialization_alias="updatedAt"
    )
    published_at: str | None = Field(
        default=None, alias="publishedAt", serialization_alias="publishedAt"
    )
    updated_by: str | None = Field(
        default=None, alias="updatedBy", serialization_alias="updatedBy"
    )
    published_by: str | None = Field(
        default=None, alias="publishedBy", serialization_alias="publishedBy"
    )


class BusinessPolicyConfigResponse(BaseModel):
    policy: BusinessPolicyPayloadModel
    meta: BusinessPolicyConfigMetaModel


class UpdateBusinessPolicyConfigRequest(BaseModel):
    policy: BusinessPolicyPayloadModel


class BusinessPolicyOverviewItemModel(BaseModel):
    source: str
    value: str | bool | None = None
    configured: bool | None = None


class BusinessPolicyRuntimeSnapshotModel(BaseModel):
    policy: BusinessPolicyPayloadModel | None = None
    source: str | None = None
    published_version: int | None = Field(
        default=None, alias="publishedVersion", serialization_alias="publishedVersion"
    )
    updated_at: str | None = Field(
        default=None, alias="updatedAt", serialization_alias="updatedAt"
    )
    updated_by: str | None = Field(
        default=None, alias="updatedBy", serialization_alias="updatedBy"
    )


class BusinessPolicyOverviewResponse(BaseModel):
    draft: BusinessPolicyConfigResponse
    published: BusinessPolicyConfigResponse
    runtime: dict
