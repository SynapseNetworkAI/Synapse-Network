import json
import logging

try:
    with open('/Users/cliff/workspace/A2A-pay/python_sdk/seller_api/app.py', 'r', encoding='utf-8') as f:
        content = f.read()

    ROUTE_CODE = """
@app.get("/api/v2/refunds")
async def get_refunds_history(wallet_address: str = Depends(require_auth)):
    try:
        intents = load_refund_intents()
        user_intents = [
            i for i in intents 
            if i.get("buyer_address", "").lower() == wallet_address.lower()
        ]
        user_intents.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        mapped_data = []
        for i in user_intents:
            tx_hash_val = i.get("tx_hash")
            if tx_hash_val and not str(tx_hash_val).strip(): tx_hash_val = None
            mapped_data.append({
                "id": i.get("intent_id"),
                "timestamp": i.get("timestamp"),
                "amount": i.get("amount", 0.0),
                "type": i.get("type", "refund"),
                "status": i.get("status", "PENDING"),
                "txHash": tx_hash_val
            })
        return {"status": "success", "data": mapped_data}
    except Exception as e:
        logger.error(f"Error fetching refunds: {e}")
        raise HTTPException(status_code=500, detail="Internal error")
"""

    if "@app.get(\"/api/v2/refunds\")" not in content:
        content += "\n" + ROUTE_CODE
        with open('/Users/cliff/workspace/A2A-pay/python_sdk/seller_api/app.py', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Refund GET route patched into app.py")
    else:
        print("GET /api/v2/refunds already exists")
except Exception as e:
    print(f"Error: {e}")
