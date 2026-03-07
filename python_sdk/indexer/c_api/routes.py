from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy.orm import Session
from indexer.database.client_db import get_client_db
from indexer.models.client_models import ClientTaskModel
from indexer.models.agent_models import AgentModel
from indexer.c_api.auth import verify_client_session

router = APIRouter(prefix="/api/client", tags=["Client API"])

@router.post("/logout")
def client_logout(_: str = Depends(verify_client_session)):
    return {"status": "success", "message": "Client session closed from backend"}

@router.get("/agents")
def get_client_agents(db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    """
    Get all agents belonging to the connected EOA owner.
    Implements Row-Level Security via owner_address filtering.
    """
    agents = db.query(AgentModel).filter(AgentModel.owner_address == owner_address).all()
    return [{"id": a.id, "name": a.name, "role": a.role, "agent_session_wallet": a.agent_session_wallet, "status": a.status} for a in agents]

from pydantic import BaseModel
class CreateAgentSchema(BaseModel):
    id: str
    name: str
    role: str
    agent_session_wallet: str

@router.post("/agents")
def create_client_agent(payload: CreateAgentSchema, db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    """
    Register a new agent under the connected owner's identity.
    """
    existing = db.query(AgentModel).filter(AgentModel.agent_session_wallet == payload.agent_session_wallet.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Agent wallet already exists in system")
    
    new_agent = AgentModel(
        id=payload.id,
        name=payload.name,
        role=payload.role,
        owner_address=owner_address,
        agent_session_wallet=payload.agent_session_wallet.lower()
    )
    db.add(new_agent)
    db.commit()
    return {"status": "success", "message": "Agent registered successfully"}


@router.get("/tasks")
def get_client_tasks(agent: str = Query(None), db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    if not agent:
        return []
    agent_lower = agent.lower()
    
    # 1. Row-Level Security (RLS) Verify - The requested agent must belong to the caller (owner_address)
    target_agent = db.query(AgentModel).filter(
        AgentModel.agent_session_wallet == agent_lower,
        AgentModel.owner_address == owner_address
    ).first()
    
    if not target_agent:
        raise HTTPException(status_code=403, detail="Forbidden: Agent does not belong to the connected owner.")
    
    # 2. Fetch tasks for this verified agent
    tasks = db.query(ClientTaskModel).filter((ClientTaskModel.buyer == agent_lower) | (ClientTaskModel.seller == agent_lower)).all()
    out = []
    for t in reversed(tasks):
        out.append({"taskId": t.task_id, "buyer": t.buyer, "seller": t.seller, "amount": t.amount, "status": t.status, "txHash": t.tx_hash, "blockNumber": t.block_number})
    return out
