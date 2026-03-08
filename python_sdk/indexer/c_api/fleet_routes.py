from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from indexer.database.client_db import get_client_db
from indexer.models.client_models import ClientTaskModel
from indexer.models.agent_models import AgentModel
from indexer.c_api.auth import verify_client_session
from typing import Optional
from datetime import datetime

router = APIRouter(prefix="/api/client/fleet", tags=["Fleet API"])

@router.get("/tasks")
def get_fleet_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    role: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_client_db), 
    owner_address: str = Depends(verify_client_session)
):
    """
    Get all tasks for all agents belonging to the connected EOA owner.
    """
    agents = db.query(AgentModel).filter(AgentModel.owner_address == owner_address.lower()).all()
    agent_wallets = [a.agent_session_wallet.lower() for a in agents]
    
    if not agent_wallets:
        return {"data": [], "total": 0, "page": page, "page_size": page_size}
        
    query = db.query(ClientTaskModel)
    
    # Filter by role
    if role == "buyer":
        query = query.filter(func.lower(ClientTaskModel.buyer).in_(agent_wallets))
    elif role == "seller":
        query = query.filter(func.lower(ClientTaskModel.seller).in_(agent_wallets))
    else:
        query = query.filter(
            (func.lower(ClientTaskModel.buyer).in_(agent_wallets)) | (func.lower(ClientTaskModel.seller).in_(agent_wallets))
        )
        
    # Filter by search term (fuzzy on title, description, buyer, and seller)
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            or_(
                ClientTaskModel.title.ilike(search_pattern),
                ClientTaskModel.description.ilike(search_pattern),
                ClientTaskModel.buyer.ilike(search_pattern),
                ClientTaskModel.seller.ilike(search_pattern)
            )
        )
        
    if status and status.lower() != 'all':
        query = query.filter(ClientTaskModel.status == status.upper())
        
    if start_date:
        try:
            sd = datetime.fromisoformat(start_date.replace("Z", ""))
            query = query.filter(ClientTaskModel.created_at >= sd)
        except ValueError:
            pass # ignore invalid date
            
    if end_date:
        try:
            ed = datetime.fromisoformat(end_date.replace("Z", ""))
            query = query.filter(ClientTaskModel.created_at <= ed)
        except ValueError:
            pass # ignore invalid date
        
    total = query.count()
    
    tasks = query.order_by(ClientTaskModel.block_number.desc().nulls_last(), ClientTaskModel.id.desc()) \
                 .offset((page - 1) * page_size) \
                 .limit(page_size).all()
    
    out = []
    for t in tasks:
        out.append({
            "taskId": t.task_id, 
            "buyer": t.buyer, 
            "seller": t.seller, 
            "amount": t.amount, 
            "status": t.status, 
            "title": t.title, 
            "description": t.description, 
            "result_data": t.result_data, 
            "txHash": t.tx_hash, 
            "blockNumber": t.block_number,
            "createdAt": t.created_at.isoformat() if t.created_at else None
        })
        
    return {"data": out, "total": total, "page": page, "page_size": page_size}
