import uvicorn
from fastapi import FastAPI, Header, HTTPException, Depends
from web3 import Web3
from web3.exceptions import TransactionNotFound
from pydantic import BaseModel
import os
import json
import time

app = FastAPI(title='A2A Agent Provider API')

RPC_URL = os.getenv('RPC_URL', 'http://127.0.0.1:8545')
SELLER_ADDRESS = os.getenv('SELLER_ADDRESS', '0x0000000000000000000000000000000000000000')
EXPECTED_PRICE = int(os.getenv('EXPECTED_PRICE', '1000000000000000000'))
ROUTER_ADDRESS = os.getenv('ROUTER_ADDRESS', '0x0000000000000000000000000000000000000000')

w3 = Web3(Web3.HTTPProvider(RPC_URL))
used_tx_hashes = set()

class InferenceRequest(BaseModel):
    prompt: str
    service_id: str

def verify_payment(tx_hash: str, expected_service_id: str):
    if tx_hash in used_tx_hashes:
        raise HTTPException(status_code=400, detail='Transaction hash already used (replay attack)')
    try:
        tx_receipt = w3.eth.get_transaction_receipt(tx_hash)
    except TransactionNotFound:
        raise HTTPException(status_code=400, detail='Transaction not found on chain')
    if tx_receipt['status'] != 1:
        raise HTTPException(status_code=400, detail='Transaction failed on chain')
    abi_path = os.path.join(os.path.dirname(__file__), 'A2APaySyncRouterABI.json')
    try:
        with open(abi_path, 'r') as f:
            router_abi = json.load(f)
    except FileNotFoundError:
        print('Warning: A2APaySyncRouterABI.json not found.')
        used_tx_hashes.add(tx_hash)
        return True
    router_contract = w3.eth.contract(address=w3.to_checksum_address(ROUTER_ADDRESS), abi=router_abi)
    service_paid_events = router_contract.events.ServicePaid().process_receipt(tx_receipt)
    if not service_paid_events:
        raise HTTPException(status_code=400, detail='No ServicePaid event found in transaction')
    event = service_paid_events[0]['args']
    if event['seller'].lower() != SELLER_ADDRESS.lower():
        raise HTTPException(status_code=400, detail='Payment was not directed to this seller')
    if event['amount'] < EXPECTED_PRICE:
        raise HTTPException(status_code=400, detail='Payment amount insufficient')
    if event['serviceId'] != expected_service_id:
        raise HTTPException(status_code=400, detail='Service ID mismatch')
    used_tx_hashes.add(tx_hash)
    return True

@app.post('/api/v1/generate')
async def generate_response(request: InferenceRequest, x_tx_hash: str = Header(..., alias='X-Tx-Hash')):
    verify_payment(x_tx_hash, request.service_id)
    time.sleep(1)
    return {'status': 'success', 'data': {'result': f"Agent Response to '{request.prompt}'.", 'provider_signature': '0x123'}}

if __name__ == '__main__':
    uvicorn.run('seller_fastapi:app', host='0.0.0.0', port=8000, reload=True)
