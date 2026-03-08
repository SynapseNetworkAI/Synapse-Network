from sqlalchemy import Column, Integer, String
from indexer.database.admin_db import AdminBase

class AdminTaskModel(AdminBase):
    __tablename__ = "admin_tasks"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, index=True)
    buyer = Column(String, index=True)
    seller = Column(String, index=True)
    amount = Column(String)
    status = Column(String)
    tx_hash = Column(String)
    block_number = Column(Integer)
    # Admin could theoretically have more system level columns, simulating separation:
    system_fee = Column(String, nullable=True)

class AdminSyncState(AdminBase):
    __tablename__ = "admin_sync_state"
    id = Column(Integer, primary_key=True, index=True)
    last_block = Column(Integer, default=0)
