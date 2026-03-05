from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from indexer.database.client_db import get_client_db
from indexer.models.client_models import ClientTaskModel
from indexer.c_api.auth import verify_client_session

router = APIRouter(prefix="/api/client", tags=["Client API"])

@router.post("/logout")
def client_logout(_: str = Depends(verify_client_session)):
    return {"status": "success", "message": "Client session closed from backend"}

@router.get("/tasks")
def get_client_tasks(agent: str = Query(None), db: Session = Depends(get_client_db), _: str = Depends(verify_client_session)):
    if not agent:
        return []
    agent_lower = agent.lower()
    tasks = db.query(ClientTaskModel).filter((ClientTaskModel.buyer == agent_lower) | (ClientTaskModel.seller == agent_lower)).all()
    out = []
    for t in reversed(tasks):
        out.append({"taskId": t.task_id, "buyer": t.buyer, "seller": t.seller, "amount": t.amount, "status": t.status, "txHash": t.tx_hash, "blockNumber": t.block_number})
    return out
