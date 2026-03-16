from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str
    otp_code: str = Field(alias="otpCode")


class AdminProfile(BaseModel):
    admin_id: str = Field(serialization_alias="adminId")
    email: str
    display_name: str = Field(serialization_alias="displayName")
    role: str
    permissions: list[str] = []


class LoginResponse(BaseModel):
    access_token: str = Field(serialization_alias="accessToken")
    token_type: str = Field(default="bearer", serialization_alias="tokenType")
    expires_in: int = Field(default=3600, serialization_alias="expiresIn")
    admin: AdminProfile
