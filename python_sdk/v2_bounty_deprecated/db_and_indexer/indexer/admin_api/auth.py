from fastapi import Depends, HTTPException, Header
from typing import Optional

def verify_admin_session(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Admin Secret Token Missing")
    # Simulated check: In AdminGuard, we check for a valid OTP/session
    # Frontend will pass this.
    if authorization != "Bearer god_mode_active":
        raise HTTPException(status_code=403, detail="Invalid God Mode Session")
    return authorization
