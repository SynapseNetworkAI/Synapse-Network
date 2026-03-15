from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SynapseResponse(BaseModel):
    content: Any = Field(description="The actual result or reply from the service.")
    tx_hash: Optional[str] = Field(default=None, description="The blockchain transaction hash, if on-chain settlement occurred.")
    fee_deducted: float = Field(default=0.0, description="The amount of USDC deducted for this call.")
    raw_response: Dict[str, Any] = Field(default_factory=dict, description="Raw response payload from the gateway.")


class ServiceInvokeSpec(BaseModel):
    method: str = ""
    request: Dict[str, Any] = Field(default_factory=dict)
    response: Dict[str, Any] = Field(default_factory=dict)


class DiscoveredService(BaseModel):
    serviceId: str = ""
    serviceName: str = ""
    pricing: str = ""
    summary: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    invoke: ServiceInvokeSpec = Field(default_factory=ServiceInvokeSpec)


class DiscoveryResponse(BaseModel):
    status: str = "success"
    count: int = 0
    services: List[DiscoveredService] = Field(default_factory=list)


class ToolFunctionSpec(BaseModel):
    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = Field(default_factory=dict)


class ToolSpec(BaseModel):
    type: str = "function"
    function: ToolFunctionSpec
