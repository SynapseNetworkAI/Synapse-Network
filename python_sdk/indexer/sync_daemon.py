import os
import json
import time
from web3 import Web3

RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
w3 = Web3(Web3.HTTPProvider(RPC_URL))
ESCROW_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"

try:
    with open(os.path.join(os.path.dirname(__file__), "..", "EscrowABI.json"), "r") as f:
        escrow_abi = json.load(f)
except Exception as e:
    escrow_abi = []

def listen_to_events(session_maker, task_model, sync_model, name_label="Indexer"):
    print(f"🚀 {name_label} Background Thread Started: Listening for on-chain events...")
    while not w3.is_connected():
        time.sleep(5)
    
    contract = w3.eth.contract(address=w3.to_checksum_address(ESCROW_ADDRESS), abi=escrow_abi)
    
    db = session_maker()
    state = db.query(sync_model).first()
    if not state:
        state = sync_model(last_block=0)
        db.add(state)
        db.commit()
    
    last_block = state.last_block
    print(f"🔄 {name_label} resuming event sync from block {last_block}...")

    while True:
        try:
            current_block = w3.eth.block_number
            if current_block > last_block:
                
                # Fetch Created events
                events = contract.events.TaskCreated.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    if not db.query(task_model).filter(task_model.task_id == h).first():
                        db.add(task_model(
                            task_id=h, 
                            buyer=event.args.buyer, 
                            seller=event.args.seller, 
                            amount=str(w3.from_wei(event.args.amount, "ether")), 
                            status="LOCKED", 
                            tx_hash=event.transactionHash.hex(), 
                            block_number=event.blockNumber
                        ))
                        db.commit()

                # Fetch Completed/Released
                events2 = contract.events.TaskCompleted.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events2:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    task = db.query(task_model).filter(task_model.task_id == h).first()
                    if task: 
                        task.status = "RELEASED"
                        db.commit()

                # Fetch Dispute Raised
                events3 = contract.events.DisputeRaised.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events3:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    task = db.query(task_model).filter(task_model.task_id == h).first()
                    if task: 
                        task.status = "DISPUTED"
                        db.commit()

                # Fetch Dispute Resolved
                events4 = contract.events.DisputeResolved.get_logs(from_block=last_block + 1, to_block=current_block)
                for event in events4:
                    h = "0x" + event.args.taskId.hex() if isinstance(event.args.taskId, bytes) else str(event.args.taskId)
                    task = db.query(task_model).filter(task_model.task_id == h).first()
                    if task: 
                        task.status = "RESOLVED"
                        db.commit()

                state.last_block = current_block
                db.commit()
                last_block = current_block

            time.sleep(2)
        except Exception as e:
            db.rollback()
            print(f"Error syncing events in {name_label}: {e}")
            time.sleep(5)
