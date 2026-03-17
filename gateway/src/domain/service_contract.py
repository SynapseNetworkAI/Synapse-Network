from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SchemaDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    body: dict[str, Any] = Field(default_factory=dict)


class ServiceCapability(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = ""
    description: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)


class ServiceExample(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = ""
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)


class ServiceLimitation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str = ""
    message: str = ""
    detail: Optional[str] = None


class ServiceManifestRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    seller_id: str = Field(alias="sellerId")
    service_name: str = Field(alias="serviceName")
    manifest_version: str = Field(alias="manifestVersion")
    status: Literal["draft", "active", "paused", "archived"] = "draft"
    description_for_model: str = Field(alias="descriptionForModel")
    task_category: Optional[str] = Field(default=None, alias="taskCategory")
    capabilities: list[ServiceCapability] = Field(default_factory=list)
    input_schema: SchemaDocument = Field(default_factory=SchemaDocument, alias="inputSchema")
    output_schema: SchemaDocument = Field(default_factory=SchemaDocument, alias="outputSchema")
    examples: list[ServiceExample] = Field(default_factory=list)
    limitations: list[ServiceLimitation] = Field(default_factory=list)
    price_model: Literal["fixed", "tiered", "quote"] = Field(alias="priceModel")
    base_price_usdc: Decimal = Field(default=Decimal("0"), alias="basePriceUsdc")
    quote_required: bool = Field(default=True, alias="quoteRequired")
    settlement_currency: str = Field(default="USDC", alias="settlementCurrency")
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class ServiceEndpointRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    endpoint_id: str = Field(alias="endpointId")
    service_id: str = Field(alias="serviceId")
    endpoint_url: str = Field(alias="endpointUrl")
    auth_mode: str = Field(default="gateway_forward", alias="authMode")
    timeout_ms: int = Field(default=15000, alias="timeoutMs")
    max_payload_bytes: int = Field(default=4194304, alias="maxPayloadBytes")
    streaming_supported: bool = Field(default=False, alias="streamingSupported")
    async_supported: bool = Field(default=False, alias="asyncSupported")
    callback_supported: bool = Field(default=False, alias="callbackSupported")
    region: Optional[str] = None
    weight: int = 100
    is_primary: bool = Field(default=False, alias="isPrimary")
    status: Literal["active", "paused", "archived"] = "active"
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")


class ServiceHealthSnapshotRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    endpoint_id: str = Field(alias="endpointId")
    health_score: int = Field(default=100, alias="healthScore")
    p95_latency_ms: Optional[int] = Field(default=None, alias="p95LatencyMs")
    success_rate_24h: Optional[Decimal] = Field(default=None, alias="successRate24h")
    last_checked_at: Optional[str] = Field(default=None, alias="lastCheckedAt")
    error_code: Optional[str] = Field(default=None, alias="errorCode")
    updated_at: str = Field(default="", alias="updatedAt")


class ServiceSearchIndexRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    tags: list[str] = Field(default_factory=list)
    search_text: str = Field(alias="searchText")
    embedding_ref: Optional[str] = Field(default=None, alias="embeddingRef")
    reliability_tier: Optional[str] = Field(default=None, alias="reliabilityTier")
    health_score: Optional[int] = Field(default=None, alias="healthScore")
    p95_latency_ms: Optional[int] = Field(default=None, alias="p95LatencyMs")
    success_rate_24h: Optional[Decimal] = Field(default=None, alias="successRate24h")
    updated_at: str = Field(default="", alias="updatedAt")


class ServiceCatalogRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    manifest: ServiceManifestRecord
    primary_endpoint: Optional[ServiceEndpointRecord] = Field(default=None, alias="primaryEndpoint")
    search_index: Optional[ServiceSearchIndexRecord] = Field(default=None, alias="searchIndex")