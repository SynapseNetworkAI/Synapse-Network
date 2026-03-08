from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from indexer.database.admin_db import get_admin_db
from indexer.models.admin_models import AdminTaskModel
from indexer.admin_api.auth import verify_admin_session

router = APIRouter(prefix="/api/admin", tags=["Admin API"])

@router.get("/tasks")
def get_admin_tasks(db: Session = Depends(get_admin_db), _: str = Depends(verify_admin_session)):
    """
    Admin facing API. Returns all system-wide tasks unconditionally.
    """
    tasks = db.query(AdminTaskModel).all()
    out = []
    for t in reversed(tasks):
        out.append({
            "taskId": t.task_id, 
            "buyer": t.buyer, 
            "seller": t.seller, 
            "amount": t.amount, 
            "status": t.status, 
            "txHash": t.tx_hash, 
            "blockNumber": t.block_number,
            "systemFee": t.system_fee
        })
    return out

@router.get("/stats")
def get_admin_stats(db: Session = Depends(get_admin_db), _: str = Depends(verify_admin_session)):
    """
    Admin facing stats.
    """
    tasks = db.query(AdminTaskModel).all()
    total_volume = sum([float(t.amount) for t in tasks if t.amount])
    revenue = total_volume * 0.025
    
    return {
        "totalTxs": len(tasks), 
        "totalVolume": str(total_volume), 
        "treasuryRevenue": str(revenue)
    }

@router.post("/logout")
def admin_logout(_: str = Depends(verify_admin_session)):
    return {"status": "success", "message": "Admin session closed from backend"}
