from fastapi import Depends, HTTPException, Header
from typing import Optional

# In a real environment, this might use OAuth2, JWTs.
# For Phase 16 isolation goals, we'll implement a simple Developer Session guard.
def verify_client_session(
    authorization: Optional[str] = Header(None, description="Bearer token"),
    x_user_address: Optional[str] = Header(None, description="Connected EOA Address for Client")
):
    if not authorization:
        raise HTTPException(status_code=401, detail="Client / Developer Token Missing")
    # Our frontend sets 'Bearer active' when simulating dev login
    # In a real system, you would decode the JWT here
    if authorization != "Bearer active":
        raise HTTPException(status_code=403, detail="Invalid Client Session")
    
    if not x_user_address:
        raise HTTPException(status_code=401, detail="X-User-Address header missing. Cannot verify Web3 identity.")
    
    # Return lowercased address for strict RLS database filtering down the line
    return x_user_address.lower()
