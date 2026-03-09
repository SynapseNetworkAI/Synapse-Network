from typing import Any, Dict, List, Optional, TypedDict


class ServiceInvokeSpec(TypedDict, total=False):
    method: str
    request: Dict[str, Any]
    response: Dict[str, Any]


class DiscoveredService(TypedDict, total=False):
    serviceId: str
    serviceName: str
    pricing: str
    summary: Optional[str]
    tags: List[str]
    invoke: ServiceInvokeSpec


class DiscoveryResponse(TypedDict, total=False):
    status: str
    count: int
    services: List[DiscoveredService]


class ToolFunctionSpec(TypedDict, total=False):
    name: str
    description: str
    parameters: Dict[str, Any]


class ToolSpec(TypedDict, total=False):
    type: str
    function: ToolFunctionSpec
