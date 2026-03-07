import os
import requests
import uuid
import logging
from eth_account import Account

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api/client")

def setup_test_agents():
    """
    Creates a fresh Buyer Agent and Seller Agent for testing
    Returns:
       buyer_owner, buyer_wallet, seller_owner, seller_wallet
    """
    logging.getLogger("Utils").info("Creating fresh transient test agents...")
    
    # 1. Create Buyer
    buyer_user = Account.create()
    buyer_agent = Account.create()
    b_owner = buyer_user.address
    b_wallet = buyer_agent.address
    
    res = requests.post(f"{API_BASE_URL}/agents", json={
        "id": str(uuid.uuid4()),
        "name": "Auto Test Buyer",
        "role": "Buyer",
        "agent_session_wallet": b_wallet
    }, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer active",
        "X-User-Address": b_owner
    })
    res.raise_for_status()
    
    # 2. Create Seller
    seller_user = Account.create()
    seller_agent = Account.create()
    s_owner = seller_user.address
    s_wallet = seller_agent.address
    
    res = requests.post(f"{API_BASE_URL}/agents", json={
        "id": str(uuid.uuid4()),
        "name": "Auto Test Seller",
        "role": "Seller",
        "agent_session_wallet": s_wallet
    }, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer active",
        "X-User-Address": s_owner
    })
    res.raise_for_status()
    
    return b_owner, b_wallet, s_owner, s_wallet

def get_headers(owner_address: str):
    return {
        "Content-Type": "application/json",
        "Authorization": "Bearer active",
        "X-User-Address": owner_address
    }

def setup_real_agents(buyer_priv: str, seller_priv: str):
    """
    Creates a Buyer Agent and Seller Agent using real funded private keys
    """
    logging.getLogger("Utils").info("Registering real funded agents...")
    
    buyer_acct = Account.from_key(buyer_priv)
    seller_acct = Account.from_key(seller_priv)
    
    b_addr = buyer_acct.address
    s_addr = seller_acct.address
    
    # 1. Register Buyer (owner and agent same address for simplicity)
    res = requests.post(f"{API_BASE_URL}/agents", json={
        "id": str(uuid.uuid4()),
        "name": "Real Test Buyer",
        "role": "Buyer",
        "agent_session_wallet": b_addr
    }, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer active",
        "X-User-Address": b_addr
    })
    # Ignore 400s if already registered
    if res.status_code not in (200, 400):
        res.raise_for_status()
        
    # 2. Register Seller  
    res = requests.post(f"{API_BASE_URL}/agents", json={
        "id": str(uuid.uuid4()),
        "name": "Real Test Seller",
        "role": "Seller",
        "agent_session_wallet": s_addr
    }, headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer active",
        "X-User-Address": s_addr
    })
    if res.status_code not in (200, 400):
        res.raise_for_status()

    return b_addr, b_addr, s_addr, s_addr
