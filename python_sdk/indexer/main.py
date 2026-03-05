import json
import os
import threading
import time
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker
from web3 import Web3

DATABASE_URL = "sqlite:///./indexer.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class TaskModel(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(String, index=True)
    buyer = Column(String, index=True)
    seller = Column(String, index=True)
    amount = Column(String)
    status = Column(String)
    tx_hash = Column(String)
    block_number = Column(Integer)

class SyncState(Base):
    __tablename__ = "sync_state"
    id = Column(Integer, primary_key=True, index=True)
    last_block = Column(Integer, default=0)

RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
w3 = Web3(Web3.HTTPProvider(RPC_URL))
ESCROW_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
try:
    with open(os.path.join(os.path.dirname(__file__), "..", "EscrowABI.json"), "r") as f:
        escrow_abi = json.load(f)
except Exception as e:
    escrow_abi = []

def listen_to_events():
    print("🚀 Indexer Background Thread Started: Listening for on-chain events...")
    while not w3.is_connected():
        time.sleep(5)
    contract = w3.eth.contract(address=w3.to_checksum_address(ESCROW_ADDRESS), abi=escrow_abi)
    
    db = SessionLocal()
    state = db.query(SyncState).first()
    if not state:
        state = SyncState(last_block=0)
        db.add(state)
        db.commit()
    
    last_block = state.last_block
    print(f"🔄 Resuming event sync from block {last_block}...")

    while True:
        try:
            current_block = w3.eth.block_number
            if current_block > last_block:
                events = contract.events.TaskCreated.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    if not db.query(TaskModel).filter(TaskModel.task_id == h).first():
                        db.add(TaskModel(task_id=h, buyer=event.args.buyer, seller=event.args.seller, amount=str(w3.from_wei(event.args.amount, "ether")), status="LOCKED", tx_hash=event.transactionHash.hex(), block_number=event.blockNumber))
                        db.commit()

                events2 = contract.events.TaskCompleted.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events2:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    task = db.query(TaskModel).filter(TaskModel.task_id == h).first()
                    if task: 
                        task.status = "RELEASED"
                        db.commit()

                events3 = contract.events.DisputeRaised.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events3:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    task = db.query(TaskModel).filter(TaskModel.task_id == h).first()
                    if task: 
                        task.status = "DISPUTED"
                        db.commit()

                events4 = contract.events.DisputeResolved.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events4:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    task = db.query(TaskModel).filter(TaskModel.task_id == h).first()
                    if task: 
                        task.status = "RESOLVED"
                        db.commit()

                state.last_block = current_block
                db.commit()
                last_block = current_block
            time.sleep(2)
        except Exception as e:
            db.rollback()
            print(f"Error syncing events: {e}")
            time.sleep(5)

app = FastAPI(title="A2A-Pay API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    threading.Thread(target=listen_to_events, daemon=True).start()

@app.get("/api/tasks")
def get_tasks():
    db = SessionLocal()
    tasks = db.query(TaskModel).all()
    out = []
    for t in reversed(tasks):
        out.append({"taskId": t.task_id, "buyer": t.buyer, "seller": t.seller, "amount": t.amount, "status": t.status, "txHash": t.tx_hash, "blockNumber": t.block_number})
    db.close()
    return out

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
