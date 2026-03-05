from fastapi import Depends, HTTPException, Header
from typing import Optional

# In a real environment, this might use OAuth2, JWTs.
# For Phase 16 isolation goals, we'll implement a simple Developer Session guard.
def verify_client_session(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Client / Developer Token Missing")
    # Our frontend sets 'Bearer active' when simulating dev login
    # In a real system, you would decode the JWT here
    if authorization != "Bearer active":
        raise HTTPException(status_code=403, detail="Invalid Client Session")
    return authorization
