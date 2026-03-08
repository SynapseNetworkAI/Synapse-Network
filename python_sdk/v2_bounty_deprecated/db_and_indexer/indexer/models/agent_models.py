from sqlalchemy import Column, Integer, String, Numeric, DateTime
# use ClientBase to share the same DB
from indexer.database.client_db import ClientBase
import datetime

class AgentModel(ClientBase):
    __tablename__ = "agents"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    role = Column(String)
    
    # ---------------- 身份与管理权限隔离的核心字段 (Row-level Security) ----------------
    owner_address = Column(String, index=True, nullable=False)
    
    # ---------------- 资金与执行层面隔离的核心字段 (Session Wallet) ----------------
    agent_session_wallet = Column(String, unique=True, nullable=False) 
    
    status = Column(String, default="active")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
