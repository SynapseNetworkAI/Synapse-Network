from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


JSON_CONTENT_TYPE = "application/json"


class SchemaDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    body: dict[str, Any] = Field(default_factory=dict)


class RuntimePayloadRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    body: dict[str, Any] = Field(default_factory=dict)


class PublicPricingRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    amount: str = "0"
    currency: str = "USDC"


class PublicHealthSummaryRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    overall_status: str = Field(default="unknown", alias="overallStatus")
    healthy_targets: int = Field(default=0, alias="healthyTargets")
    total_targets: int = Field(default=0, alias="totalTargets")
    last_checked_at: Optional[int] = Field(default=None, alias="lastCheckedAt")


class QuoteInputPreviewRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    content_type: str = Field(default=JSON_CONTENT_TYPE, alias="contentType")
    payload_schema: SchemaDocument = Field(default_factory=SchemaDocument, alias="payloadSchema")
    sample: RuntimePayloadRecord = Field(default_factory=RuntimePayloadRecord)


class QuoteRequestDraftRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    input_preview: QuoteInputPreviewRecord = Field(default_factory=QuoteInputPreviewRecord, alias="inputPreview")
    response_mode: Literal["sync", "async", "stream"] = Field(default="sync", alias="responseMode")


class AgentDiscoveryQueryRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    query: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    max_price_usdc: Optional[Decimal] = Field(default=None, alias="maxPriceUsdc")
    requires_structured_output: bool = Field(default=False, alias="requiresStructuredOutput")
    region: Optional[str] = None
    limit: int = 10
    sort: Literal["best_match", "lowest_price", "fastest", "highest_reliability"] = "best_match"


class PublicServiceDiscoveryRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    service_name: str = Field(alias="serviceName")
    pricing: PublicPricingRecord = Field(default_factory=PublicPricingRecord)
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    status: str = "unknown"
    health: PublicHealthSummaryRecord = Field(default_factory=PublicHealthSummaryRecord)
    invoke: "ServiceInvokeConfigRecord" = Field(default_factory=lambda: ServiceInvokeConfigRecord())
    quote_template: QuoteRequestDraftRecord = Field(alias="quoteTemplate")


class ServiceConstraintRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    timeout_ms: int = Field(default=15000, alias="timeoutMs")
    max_qps: int = Field(default=100, alias="maxQps")
    max_request_bytes: int = Field(default=4194304, alias="maxRequestBytes")
    max_response_bytes: int = Field(default=4194304, alias="maxResponseBytes")


class ServiceRequestSpecRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    content_type: str = Field(default=JSON_CONTENT_TYPE, alias="contentType")
    schema_document: SchemaDocument = Field(default_factory=SchemaDocument, alias="schema")


class ServiceResponseSpecRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    content_type: str = Field(default=JSON_CONTENT_TYPE, alias="contentType")
    schema_document: SchemaDocument = Field(default_factory=SchemaDocument, alias="schema")


class ServiceInvokeTargetRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    url: str
    weight: int = 100
    region: Optional[str] = None


class ServiceInvokeConfigRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    method: Literal["POST", "GET", "PUT", "PATCH", "DELETE"] = "POST"
    targets: list[ServiceInvokeTargetRecord] = Field(default_factory=list)
    timeout_ms: int = Field(default=15000, alias="timeoutMs")
    request: ServiceRequestSpecRecord = Field(default_factory=ServiceRequestSpecRecord)
    response: ServiceResponseSpecRecord = Field(default_factory=ServiceResponseSpecRecord)
    headers_template: dict[str, str] = Field(default_factory=dict, alias="headersTemplate")
    examples: list[dict[str, Any]] = Field(default_factory=list)


class ServiceAuthRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    auth_type: str = Field(default="", alias="type")
    header_name: Optional[str] = Field(default=None, alias="headerName")
    config: dict[str, Any] = Field(default_factory=dict)


class ServiceHealthCheckRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    path: str = "/health"
    method: str = "GET"
    timeout_ms: Optional[int] = Field(default=None, alias="timeoutMs")
    success_codes: list[int] = Field(default_factory=list, alias="successCodes")
    healthy_threshold: Optional[int] = Field(default=None, alias="healthyThreshold")
    unhealthy_threshold: Optional[int] = Field(default=None, alias="unhealthyThreshold")


class ServiceRetryPolicyRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    max_attempts: int = Field(default=2, alias="maxAttempts")
    backoff_ms: int = Field(default=200, alias="backoffMs")
    retry_on_status: list[int] = Field(default_factory=list, alias="retryOnStatus")


class ServiceForwardingRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    request_id_header: str = Field(default="X-Synapse-Request-Id", alias="requestIdHeader")
    pass_through_headers: list[str] = Field(default_factory=list, alias="passThroughHeaders")
    inject_headers: dict[str, str] = Field(default_factory=dict, alias="injectHeaders")
    retry_policy: ServiceRetryPolicyRecord = Field(default_factory=ServiceRetryPolicyRecord, alias="retryPolicy")


class ServiceMeteringRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    billing_unit: str = Field(default="per_call", alias="billingUnit")
    bill_on_error: bool = Field(default=False, alias="billOnError")
    billable_status_classes: list[int] = Field(default_factory=list, alias="billableStatusClasses")
    request_id_required: bool = Field(default=True, alias="requestIdRequired")
    response_size_metering: bool = Field(default=True, alias="responseSizeMetering")


class ServiceHealthTargetRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_url: str = Field(alias="targetUrl")
    status: str = "unknown"
    weight: int = 100
    region: Optional[str] = None
    http_status: Optional[int] = Field(default=None, alias="httpStatus")
    latency_ms: Optional[int] = Field(default=None, alias="latencyMs")
    consecutive_successes: int = Field(default=0, alias="consecutiveSuccesses")
    consecutive_failures: int = Field(default=0, alias="consecutiveFailures")
    probe_url: Optional[str] = Field(default=None, alias="probeUrl")
    last_checked_at: Optional[int] = Field(default=None, alias="lastCheckedAt")
    last_healthy_at: Optional[int] = Field(default=None, alias="lastHealthyAt")
    error: Optional[str] = None


class ServiceRuntimeHealthRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    overall_status: str = Field(default="unknown", alias="overallStatus")
    healthy_targets: int = Field(default=0, alias="healthyTargets")
    total_targets: int = Field(default=0, alias="totalTargets")
    last_checked_at: Optional[int] = Field(default=None, alias="lastCheckedAt")
    targets: list[ServiceHealthTargetRecord] = Field(default_factory=list)


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


class ServiceDefinitionRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    service_id: str = Field(alias="serviceId")
    owner_address: str = Field(alias="ownerAddress")
    service_name: str = Field(default="", alias="serviceName")
    summary: str = ""
    status: str = "active"
    is_active: bool = Field(default=True, alias="isActive")
    pricing_amount: Decimal = Field(default=Decimal("0"), alias="pricingAmount")
    pricing_currency: str = Field(default="USDC", alias="pricingCurrency")
    constraints: ServiceConstraintRecord = Field(default_factory=ServiceConstraintRecord)
    id: Optional[str] = None
    schema_version: Optional[int] = Field(default=None, alias="schemaVersion")
    role: Optional[str] = None
    address: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    auth: ServiceAuthRecord = Field(default_factory=ServiceAuthRecord)
    health_check: ServiceHealthCheckRecord = Field(default_factory=ServiceHealthCheckRecord, alias="healthCheck")
    forwarding: ServiceForwardingRecord = Field(default_factory=ServiceForwardingRecord)
    metering: ServiceMeteringRecord = Field(default_factory=ServiceMeteringRecord)
    invoke: ServiceInvokeConfigRecord = Field(default_factory=ServiceInvokeConfigRecord)
    created_at: str = Field(default="", alias="createdAt")
    updated_at: str = Field(default="", alias="updatedAt")
    primary_endpoint: Optional[ServiceEndpointRecord] = Field(default=None, alias="primaryEndpoint")
    search_index: Optional[ServiceSearchIndexRecord] = Field(default=None, alias="searchIndex")
    runtime_health: Optional[ServiceRuntimeHealthRecord] = Field(default=None, alias="serviceHealth")

    @property
    def endpoint(self) -> Optional[str]:
        if self.primary_endpoint is not None and self.primary_endpoint.endpoint_url:
            return self.primary_endpoint.endpoint_url
        if self.invoke.targets:
            return self.invoke.targets[0].url
        return None