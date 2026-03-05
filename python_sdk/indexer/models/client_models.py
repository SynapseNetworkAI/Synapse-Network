from sqlalchemy import Column, Integer, String
from indexer.database.client_db import ClientBase

class ClientTaskModel(ClientBase):
    __tablename__ = "client_tasks"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, index=True)
    buyer = Column(String, index=True)
    seller = Column(String, index=True)
    amount = Column(String)
    status = Column(String)
    tx_hash = Column(String)
    block_number = Column(Integer)

class ClientSyncState(ClientBase):
    __tablename__ = "client_sync_state"
    id = Column(Integer, primary_key=True, index=True)
    last_block = Column(Integer, default=0)
