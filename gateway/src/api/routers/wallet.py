from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel

from src.core.common import normalize_wallet
from src.domain.runtime_state import WalletRoleState
from src.storage import BaseStorage, get_storage
from src.utils.datetime_utils import now_dt_str

router = APIRouter()


class BindRoleRequest(BaseModel):
    role: str


AddressPath = Annotated[str, Path(...)]
StorageDep = Annotated[BaseStorage, Depends(get_storage)]
BindRoleBody = Annotated[BindRoleRequest, Body(...)]


@router.get(
    "/v1/wallet/role/{address}", responses={404: {"description": "Role not found"}}
)
async def get_wallet_role(
    address: AddressPath,
    storage: StorageDep,
):
    """获取用户的身份角色(buyer或seller)"""
    wallet = normalize_wallet(address)
    role_state = storage.get_data_manager().system.credential_auth.read_wallet_role(
        wallet
    )

    if not role_state or not role_state.role:
        raise HTTPException(status_code=404, detail="Role not found")

    return {"role": role_state.role}


@router.post(
    "/v1/wallet/role/{address}/bind",
    responses={400: {"description": "Invalid role specified"}},
)
async def bind_wallet_role(
    address: AddressPath,
    req: BindRoleBody,
    storage: StorageDep,
):
    """为用户绑定身份角色(buyer或seller)"""
    wallet = normalize_wallet(address)

    if req.role not in ["buyer", "seller", "CONSUMER", "PROVIDER"]:
        raise HTTPException(status_code=400, detail="Invalid role specified")

    # 统一转换成前端所需的常量宏
    bound_role = "CONSUMER" if req.role in ["buyer", "CONSUMER"] else "PROVIDER"

    storage.get_data_manager().system.credential_auth.upsert_wallet_role(
        WalletRoleState(
            walletAddress=wallet,
            role=bound_role,
            updatedAt=now_dt_str(),
        )
    )

    return {"status": "success", "role": bound_role}
