import json
import os
import threading
import time
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, sessionmaker
from web3 import Web3

# =========== Database Setup ===========
# In-memory SQLite for mocking Phase 8
DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class TaskModel(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    buyer = Column(String, index=True)
    seller = Column(String, index=True)
    amount = Column(Float)
    status = Column(String)

# Create tables
Base.metadata.create_all(bind=engine)

# =========== Pydantic Schemas ===========
class TaskOut(BaseModel):
    id: int
    buyer: str
    seller: str
    amount: float
    status: str

    class Config:
        orm_mode = True

# =========== Web3 Setup ===========
RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
w3 = Web3(Web3.HTTPProvider(RPC_URL))

# Mock Contract Setup (Normally you'd load the real ABI and address)
# Let's define a basic mock proxy for events like `TaskCreated`, `FundsLocked`, etc.
ESCROW_ADDRESS = os.environ.get("ESCROW_ADDRESS", "0x0000000000000000000000000000000000000000")
# Minimal ABI for indexing purposes
minimal_abi = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "uint256", "name": "taskId", "type": "uint256"},
            {"indexed": True, "internalType": "address", "name": "buyer", "type": "address"},
            {"indexed": True, "internalType": "address", "name": "seller", "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "TaskCreated",
        "type": "event"
    }
]

# =========== Background Thread Listener ===========
def listen_to_events():
    """
    Background thread function that uses w3 to listen to Events and write to the DB.
    """
    print("🚀 Indexer Background Thread Started: Listening for on-chain events...")
    
    # Check if connected to node
    while not w3.is_connected():
        print("Waiting for Web3 provider...")
        time.sleep(5)
    
    print(f"Connected to Web3 provider at {RPC_URL}")
    contract = w3.eth.contract(address=w3.to_checksum_address(ESCROW_ADDRESS), abi=minimal_abi)
    
    # Normally you'd use a robust event listener (e.g. w3.eth.filter, eth_getLogs). 
    # For a simple mock setup, we fetch recent blocks.
    last_block = w3.eth.block_number
    
    db = SessionLocal()
    while True:
        try:
            current_block = w3.eth.block_number
            if current_block > last_block:
                # print(f"Processing blocks {last_block + 1} to {current_block}")
                
                # Mock logic to capture actual events if ESCROW_ADDRESS was real:
                if ESCROW_ADDRESS != "0x0000000000000000000000000000000000000000":
                    events = contract.events.TaskCreated.get_logs(fromBlock=last_block + 1, toBlock=current_block)
                    for event in events:
                        task_id = event['args']['taskId']
                        buyer = event['args']['buyer']
                        seller = event['args']['seller']
                        amount = event['args']['amount']
                        
                        # Write to DB
                        new_task = TaskModel(
                            id=task_id, 
                            buyer=buyer, 
                            seller=seller, 
                            amount=float(w3.from_wei(amount, 'ether')), 
                            status="Created"
                        )
                        db.add(new_task)
                        db.commit()
                        print(f"📦 Indexed new Task {task_id}: {buyer} -> {seller}")
                        
                last_block = current_block
                
            time.sleep(2)  # poll every 2s

        except Exception as e:
            print(f"Error in indexer thread: {e}")
            time.sleep(5)

# =========== FastAPI App Setup ===========
app = FastAPI(title="A2A-Pay Indexer & Analytics API", description="Phase 8 Off-chain Indexer APIs")

@app.on_event("startup")
def on_startup():
    # Insert some mock data for the API testing since memory DB starts empty
    db = SessionLocal()
    if db.query(TaskModel).count() == 0:
        db.add(TaskModel(id=1, buyer="0xAlice", seller="0xBob", amount=1.5, status="Locked"))
        db.add(TaskModel(id=2, buyer="0xCharlie", seller="0xDave", amount=0.75, status="Completed"))
        db.commit()
    db.close()

    # Start the event indexer in a background thread
    indexer_thread = threading.Thread(target=listen_to_events, daemon=True)
    indexer_thread.start()

@app.get("/api/tasks", response_model=List[TaskOut])
def get_tasks():
    """
    Returns the JSON list of indexed tasks.
    """
    db = SessionLocal()
    tasks = db.query(TaskModel).all()
    db.close()
    return tasks

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
