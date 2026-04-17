from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.deps import (
    get_provider_services_adapter,
    get_request_id,
    require_permission,
)
from src.api.schemas.common import ApiResponse
from src.api.schemas.provider_services import (
    ProviderServiceActionRequest,
    ProviderServiceActionResponse,
    ProviderServiceDeleteRequest,
    ProviderServiceDeleteResponse,
    ProviderServiceItem,
    ProviderServiceListResponse,
)
from src.services.adapters import ProviderServicesAdapter, ProviderServicesAdapterError
from src.services.auth.service import AdminIdentity

router = APIRouter(prefix="/api/admin/v1/provider-services", tags=["admin-provider-services"])


def _gateway_error(exc: ProviderServicesAdapterError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"code": exc.code, "message": exc.message},
    )


@router.get("", response_model=ApiResponse)
def list_provider_services(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    adapter: Annotated[ProviderServicesAdapter, Depends(get_provider_services_adapter)],
    query: Annotated[str | None, Query(min_length=1, max_length=128)] = None,
    status: Annotated[str | None, Query(max_length=32)] = None,
    runtime_status: Annotated[str | None, Query(alias="runtimeStatus", max_length=32)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
):
    try:
        payload = adapter.list_services(
            actor=admin,
            params={
                "query": query,
                "status": status,
                "runtimeStatus": runtime_status,
                "page": page,
                "pageSize": page_size,
            },
        )
    except ProviderServicesAdapterError as exc:
        raise _gateway_error(exc) from exc
    return ApiResponse(
        data=ProviderServiceListResponse(**payload).model_dump(by_alias=True),
        request_id=request_id,
    )


@router.get("/{service_id}", response_model=ApiResponse)
def get_provider_service(
    service_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    adapter: Annotated[ProviderServicesAdapter, Depends(get_provider_services_adapter)],
):
    try:
        payload = adapter.get_service(actor=admin, service_id=service_id)
    except ProviderServicesAdapterError as exc:
        raise _gateway_error(exc) from exc
    return ApiResponse(
        data=ProviderServiceItem(**payload["service"]).model_dump(by_alias=True),
        request_id=request_id,
    )


@router.post("/{service_id}/force-probe", response_model=ApiResponse)
def force_probe_provider_service(
    service_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    adapter: Annotated[ProviderServicesAdapter, Depends(get_provider_services_adapter)],
):
    try:
        payload = adapter.force_probe(actor=admin, service_id=service_id)
    except ProviderServicesAdapterError as exc:
        raise _gateway_error(exc) from exc
    return ApiResponse(
        data=ProviderServiceActionResponse(service=payload["service"]).model_dump(by_alias=True),
        request_id=request_id,
    )


@router.post("/{service_id}/lifecycle", response_model=ApiResponse)
def update_provider_service_lifecycle(
    service_id: str,
    payload: ProviderServiceActionRequest,
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:submit"))],
    request_id: Annotated[str, Depends(get_request_id)],
    adapter: Annotated[ProviderServicesAdapter, Depends(get_provider_services_adapter)],
):
    try:
        result = adapter.update_lifecycle(
            actor=admin,
            service_id=service_id,
            action=payload.action,
            note=payload.note,
        )
    except ProviderServicesAdapterError as exc:
        raise _gateway_error(exc) from exc
    return ApiResponse(
        data=ProviderServiceActionResponse(service=result["service"]).model_dump(by_alias=True),
        request_id=request_id,
    )


@router.delete("/{service_id}", response_model=ApiResponse)
def delete_provider_service(
    service_id: str,
    payload: ProviderServiceDeleteRequest,
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:submit"))],
    request_id: Annotated[str, Depends(get_request_id)],
    adapter: Annotated[ProviderServicesAdapter, Depends(get_provider_services_adapter)],
):
    try:
        adapter.delete_service(actor=admin, service_id=service_id, note=payload.note)
    except ProviderServicesAdapterError as exc:
        raise _gateway_error(exc) from exc
    return ApiResponse(
        data=ProviderServiceDeleteResponse(
            serviceId=service_id,
            status="deleted",
        ).model_dump(by_alias=True),
        request_id=request_id,
    )
