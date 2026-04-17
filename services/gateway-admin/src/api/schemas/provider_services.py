from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProviderServicePricing(BaseModel):
    amount: str
    currency: str


class ProviderServiceItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    owner_address: str = Field(alias="ownerAddress")
    service_name: str = Field(alias="serviceName")
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    pricing: ProviderServicePricing
    control_status: str = Field(alias="controlStatus")
    status: str
    is_active: bool = Field(alias="isActive")
    runtime_status: str = Field(alias="runtimeStatus")
    runtime_available: bool = Field(alias="runtimeAvailable")
    health: dict[str, Any]
    targets: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class ProviderServiceListResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    items: list[ProviderServiceItem]
    page: int
    page_size: int = Field(alias="pageSize")
    total_count: int = Field(alias="totalCount")
    total_pages: int = Field(alias="totalPages")


class ProviderServiceActionRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)


class ProviderServiceDeleteRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class ProviderServiceActionResponse(BaseModel):
    service: ProviderServiceItem


class ProviderServiceDeleteResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    status: str
