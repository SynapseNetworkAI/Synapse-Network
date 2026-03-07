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



import uuid
from typing import Optional

class PublishTaskSchema(BaseModel):
    title: str
    description: str
    amount: str
    buyer_agent: str

@router.post("/tasks/publish")
def publish_task(payload: PublishTaskSchema, db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    buyer_lower = payload.buyer_agent.lower()
    # Verify owner
    agent = db.query(AgentModel).filter(AgentModel.agent_session_wallet == buyer_lower, AgentModel.owner_address == owner_address).first()
    if not agent:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    # Backend Role Enforcement: Only Buyer roles can publish
    if not agent.role or "buyer" not in agent.role.lower():
        raise HTTPException(status_code=403, detail="Only Buyer agents can publish tasks")
    
    task_id = str(uuid.uuid4())
    new_task = ClientTaskModel(
        task_id=task_id,
        title=payload.title,
        description=payload.description,
        buyer=buyer_lower,
        amount=payload.amount,
        status="PENDING"
    )
    db.add(new_task)
    db.commit()
    return {"status": "success", "taskId": task_id}

@router.get("/tasks/marketplace")
def get_marketplace_tasks(db: Session = Depends(get_client_db)):
    tasks = db.query(ClientTaskModel).filter(ClientTaskModel.status == "PENDING").all()
    out = []
    for t in reversed(tasks):
        out.append({
            "taskId": t.task_id, "title": t.title, "description": t.description,
            "buyer": t.buyer, "amount": t.amount, "status": t.status
        })
    return out

class TaskActionSchema(BaseModel):
    agent_wallet: str

@router.post("/tasks/{task_id}/accept")
def accept_task(task_id: str, payload: TaskActionSchema, db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    agent_lower = payload.agent_wallet.lower()
    agent = db.query(AgentModel).filter(AgentModel.agent_session_wallet == agent_lower, AgentModel.owner_address == owner_address).first()
    if not agent:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    task = db.query(ClientTaskModel).filter(ClientTaskModel.task_id == task_id).first()
    if not task or task.status != "PENDING":
        raise HTTPException(status_code=400, detail="Task not available")
        
    if task.buyer == agent_lower:
        raise HTTPException(status_code=400, detail="Cannot accept own task")
        
    task.seller = agent_lower
    task.status = "PROCESSING"
    db.commit()
    return {"status": "success"}

class DeliverTaskSchema(BaseModel):
    agent_wallet: str
    result_data: str

@router.post("/tasks/{task_id}/deliver")
def deliver_task(task_id: str, payload: DeliverTaskSchema, db: Session = Depends(get_client_db), owner_address: str = Depends(verify_client_session)):
    agent_lower = payload.agent_wallet.lower()
    agent = db.query(AgentModel).filter(AgentModel.agent_session_wallet == agent_lower, AgentModel.owner_address == owner_address).first()
    if not agent:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    task = db.query(ClientTaskModel).filter(ClientTaskModel.task_id == task_id).first()
    if not task or task.status != "PROCESSING" or task.seller != agent_lower:
        raise HTTPException(status_code=400, detail="Invalid task state or unauthorized")
        
    task.result_data = payload.result_data
    task.status = "DELIVERED"
    db.commit()
    return {"status": "success"}
