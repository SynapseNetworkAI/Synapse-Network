from fastapi import APIRouter, Depends, Path, HTTPException, Body
from typing import Dict, Any
from pydantic import BaseModel
from src.storage import get_storage, BaseStorage
from src.core.common import normalize_wallet

router = APIRouter()

class BindRoleRequest(BaseModel):
    role: str

@router.get("/v1/wallet/role/{address}")
async def get_wallet_role(
    address: str = Path(...),
    storage: BaseStorage = Depends(get_storage)
):
    """获取用户的身份角色(buyer或seller)"""
    wallet = normalize_wallet(address)
    roles = storage.get_collection('wallet_roles') or {}
    role = roles.get(wallet)
    
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
        
    return {"role": role}

@router.post("/v1/wallet/role/{address}/bind")
async def bind_wallet_role(
    address: str = Path(...),
    req: BindRoleRequest = Body(...),
    storage: BaseStorage = Depends(get_storage)
):
    """为用户绑定身份角色(buyer或seller)"""
    wallet = normalize_wallet(address)
    roles = storage.get_collection('wallet_roles') or {}
    
    if req.role not in ["buyer", "seller", "CONSUMER", "PROVIDER"]:
        raise HTTPException(status_code=400, detail="Invalid role specified")
        
    # 统一转换成前端所需的常量宏
    bound_role = "CONSUMER" if req.role in ["buyer", "CONSUMER"] else "PROVIDER"
    
    roles[wallet] = bound_role
    storage.save_collection('wallet_roles', roles)
    
    return {"status": "success", "role": bound_role}