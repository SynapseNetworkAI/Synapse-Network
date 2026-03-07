from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from indexer.database.client_db import get_client_db
from indexer.models.client_models import ClientTaskModel
from indexer.models.agent_models import AgentModel
from indexer.c_api.auth import verify_client_session

router = APIRouter(prefix="/api/client/fleet", tags=["Fleet API"])

@router.get("/tasks")
def get_fleet_tasks(db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    """
    Get all tasks for all agents belonging to the connected EOA owner.
    """
    agents = db.query(AgentModel).filter(AgentModel.owner_address == owner_address.lower()).all()
    agent_wallets = [a.agent_session_wallet.lower() for a in agents]
    
    if not agent_wallets:
        return []
        
    tasks = db.query(ClientTaskModel).filter(
        (func.lower(ClientTaskModel.buyer).in_(agent_wallets)) | (func.lower(ClientTaskModel.seller).in_(agent_wallets))
    ).order_by(ClientTaskModel.block_number.desc()).limit(100).all()
    
    out = []
    for t in tasks:
        out.append({"taskId": t.task_id, "buyer": t.buyer, "seller": t.seller, "amount": t.amount, "status": t.status, "title": t.title, "description": t.description, "result_data": t.result_data, "txHash": t.tx_hash, "blockNumber": t.block_number})
    return out
