from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SDKModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SchemaDocument(SDKModel):
    body: Dict[str, Any] = Field(default_factory=dict)


class RuntimePayload(SDKModel):
    body: Dict[str, Any] = Field(default_factory=dict)


class QuoteInputPreview(SDKModel):
    content_type: str = Field(default="application/json", alias="contentType")
    payload_schema: SchemaDocument = Field(default_factory=SchemaDocument, alias="payloadSchema")
    sample: RuntimePayload = Field(default_factory=RuntimePayload)


class ServicePricing(SDKModel):
    amount: str = "0"
    currency: str = "USDC"


class ServiceHealthSummary(SDKModel):
    overall_status: str = Field(default="unknown", alias="overallStatus")
    healthy_targets: int = Field(default=0, alias="healthyTargets")
    total_targets: int = Field(default=0, alias="totalTargets")
    last_checked_at: Optional[int] = Field(default=None, alias="lastCheckedAt")


class ServiceInvokeSpec(SDKModel):
    method: str = "POST"
    targets: List[Dict[str, Any]] = Field(default_factory=list)
    timeout_ms: Optional[int] = Field(default=None, alias="timeoutMs")
    request: Dict[str, Any] = Field(default_factory=dict)
    response: Dict[str, Any] = Field(default_factory=dict)
    headers_template: Dict[str, str] = Field(default_factory=dict, alias="headersTemplate")
    examples: List[Dict[str, Any]] = Field(default_factory=list)


class QuoteTemplate(SDKModel):
    service_id: str = Field(default="", alias="serviceId")
    input_preview: QuoteInputPreview = Field(default_factory=QuoteInputPreview, alias="inputPreview")
    response_mode: Literal["sync", "async", "stream"] = Field(default="sync", alias="responseMode")


class DiscoveredService(SDKModel):
    service_id: str = Field(default="", alias="serviceId")
    service_name: str = Field(default="", alias="serviceName")
    pricing: ServicePricing = Field(default_factory=ServicePricing)
    summary: str = ""
    tags: List[str] = Field(default_factory=list)
    status: str = "unknown"
    health: ServiceHealthSummary = Field(default_factory=ServiceHealthSummary)
    invoke: ServiceInvokeSpec = Field(default_factory=ServiceInvokeSpec)
    quote_template: QuoteTemplate = Field(default_factory=QuoteTemplate, alias="quoteTemplate")

    @property
    def price_usdc(self) -> Optional[Decimal]:
        try:
            return Decimal(str(self.pricing.amount))
        except (InvalidOperation, TypeError):
            return None

    @property
    def serviceId(self) -> str:
        return self.service_id

    @property
    def serviceName(self) -> str:
        return self.service_name


class DiscoveryResponse(SDKModel):
    request_id: str = Field(default="", alias="requestId")
    count: int = 0
    page: int = 1
    page_size: int = Field(default=10, alias="pageSize")
    total_count: int = Field(default=0, alias="totalCount")
    has_more: bool = Field(default=False, alias="hasMore")
    results: List[DiscoveredService] = Field(default_factory=list)

    @property
    def services(self) -> List[DiscoveredService]:
        return self.results


class BudgetCheck(SDKModel):
    allowed: bool = True
    remaining_budget_usdc: Optional[float] = Field(default=None, alias="remainingBudgetUsdc")


class InvokeConstraints(SDKModel):
    body: Dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int = Field(default=0, alias="timeoutMs")
    max_payload_bytes: int = Field(default=0, alias="maxPayloadBytes")


class QuoteResponse(SDKModel):
    request_id: str = Field(default="", alias="requestId")
    quote_id: str = Field(default="", alias="quoteId")
    service_id: str = Field(default="", alias="serviceId")
    price_usdc: float = Field(default=0.0, alias="priceUsdc")
    price_model: str = Field(default="fixed", alias="priceModel")
    budget_check: BudgetCheck = Field(default_factory=BudgetCheck, alias="budgetCheck")
    expires_at: str = Field(default="", alias="expiresAt")
    idempotency_scope: str = Field(default="quoteId", alias="idempotencyScope")
    invoke_constraints: InvokeConstraints = Field(default_factory=InvokeConstraints, alias="invokeConstraints")

    @property
    def quoteId(self) -> str:
        return self.quote_id

    @property
    def serviceId(self) -> str:
        return self.service_id


class InvocationReceipt(SDKModel):
    quote_id: str = Field(default="", alias="quoteId")
    invocation_id: str = Field(default="", alias="invocationId")


class InvocationError(SDKModel):
    code: str = "INVOCATION_FAILED"
    message: str = "Invocation failed"
    retryable: bool = False
    action: str = "stop"


class InvocationResponse(SDKModel):
    invocation_id: str = Field(default="", alias="invocationId")
    status: str = "PENDING"
    charged_usdc: float = Field(default=0.0, alias="chargedUsdc")
    result: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[InvocationError] = None
    receipt: Optional[InvocationReceipt] = None

    @property
    def is_terminal(self) -> bool:
        return self.status in {"SUCCEEDED", "FAILED_RETRYABLE", "FAILED_FINAL", "SETTLED"}

    @property
    def succeeded(self) -> bool:
        return self.status in {"SUCCEEDED", "SETTLED"}

    @property
    def invocationId(self) -> str:
        return self.invocation_id


class SynapseResponse(SDKModel):
    content: Any = Field(description="The actual result returned by the service.")
    quote_id: Optional[str] = Field(default=None, alias="quoteId")
    invocation_id: Optional[str] = Field(default=None, alias="invocationId")
    status: str = "SUCCEEDED"
    tx_hash: Optional[str] = Field(default=None, description="Reserved for compatibility with older direct invoke flows.")
    fee_deducted: float = Field(default=0.0, alias="feeDeducted")
    receipt: Dict[str, Any] = Field(default_factory=dict)
    raw_response: Dict[str, Any] = Field(default_factory=dict, alias="rawResponse")


class ToolFunctionSpec(SDKModel):
    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = Field(default_factory=dict)


class ToolSpec(SDKModel):
    type: str = "function"
    function: ToolFunctionSpec
