from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from indexer.database.client_db import ClientBase

class ClientTaskModel(ClientBase):
    __tablename__ = "client_tasks"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, unique=True, index=True)
    title = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    buyer = Column(String, index=True)
    seller = Column(String, index=True, nullable=True)
    amount = Column(String)
    status = Column(String) # 'PENDING', 'PROCESSING', 'DELIVERED', 'COMPLETED', 'DISPUTED'
    result_data = Column(Text, nullable=True)
    tx_hash = Column(String, nullable=True) # made nullable
    block_number = Column(Integer, nullable=True) # made nullable
    created_at = Column(DateTime, server_default=func.now(), default=func.now())

class ClientSyncState(ClientBase):
    __tablename__ = "client_sync_state"
    id = Column(Integer, primary_key=True, index=True)
    last_block = Column(Integer, default=0)
