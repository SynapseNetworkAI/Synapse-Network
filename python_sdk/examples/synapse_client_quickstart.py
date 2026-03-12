
import os
import sys
import uuid
from pathlib import Path

# Provide import path if running locally
try:
    from synapse_client import SynapseClient
except ModuleNotFoundError:
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from synapse_client import SynapseClient

def main():
    api_key = os.getenv("SYNAPSE_API_KEY")
    if not api_key:
        print("Please set SYNAPSE_API_KEY environment variable.")
        print("E.g. export SYNAPSE_API_KEY='agt_...'")
        return

    # Initialize Synapse Client
    client = SynapseClient(api_key=api_key)

    print("=== Mode 1: Hardcoded Service ID ===")
    service_id = "SVC_WEATHER_001"  # Example ID
    print(f"Calling specific service: {service_id}")
    
    try:
        response = client.call_service(
            service_id=service_id,
            payload={
                "location": "Kuala Lumpur",
                "days": 3
            }
        )
        print("
[ Invoke Success ]")
        print(f"Result Content :
{response.content}")
        print(f"Fee Deducted   : {response.fee_deducted} USDC")
        print(f"Tx Hash        : {response.tx_hash}")
    except Exception as e:
        print(f"Error calling {service_id}: {e}")

    print("
" + "="*40 + "
")

    print("=== Mode 2: Semantic Discovery ===")
    intent = "image-generation"
    print(f"Searching for network services handling: '{intent}'")
    discovery = client.discover_services(intent=intent)
    
    if not discovery.services:
        print(f"No services found for intent: {intent}")
    else:
        best_service = discovery.services[0].serviceId
        print(f"Network suggested best service: {best_service}")
        
        try:
            res = client.call_service(
                service_id=best_service,
                payload={"prompt": "A futuristic cyberpunk city"}
            )
            print("
[ Invoke Success ]")
            print(f"Result Content :
{res.content}")
            print(f"Fee Deducted   : {res.fee_deducted} USDC")
        except Exception as e:
            print(f"Error calling {best_service}: {e}")

if __name__ == '__main__':
    main()
