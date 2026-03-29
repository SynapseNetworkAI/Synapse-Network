from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str
    password: str
    otp_code: str | None = Field(default=None, alias="otpCode")


class MfaEnrollBeginRequest(BaseModel):
    enrollment_token: str = Field(alias="enrollmentToken")


class MfaEnrollVerifyRequest(BaseModel):
    enrollment_token: str = Field(alias="enrollmentToken")
    factor_id: str = Field(alias="factorId")
    otp_code: str = Field(alias="otpCode")


class AdminAuthSecurityPolicy(BaseModel):
    login_totp_required: bool = Field(serialization_alias="loginTotpRequired")
    high_risk_totp_required: bool = Field(serialization_alias="highRiskTotpRequired")
    totp_issuer: str = Field(serialization_alias="totpIssuer")


class AdminProfile(BaseModel):
    admin_id: str = Field(serialization_alias="adminId")
    email: str
    display_name: str = Field(serialization_alias="displayName")
    role: str
    permissions: list[str] = []


class LoginResponse(BaseModel):
    expires_in: int = Field(default=3600, serialization_alias="expiresIn")
    csrf_token: str = Field(serialization_alias="csrfToken")
    admin: AdminProfile
    security: AdminAuthSecurityPolicy


class MfaEnrollmentRequiredData(BaseModel):
    enrollment_token: str = Field(alias="enrollmentToken", serialization_alias="enrollmentToken")
    expires_in: int = Field(alias="expiresIn", serialization_alias="expiresIn")
    masked_email: str = Field(alias="maskedEmail", serialization_alias="maskedEmail")
    totp_issuer: str = Field(alias="totpIssuer", serialization_alias="totpIssuer")


class MfaEnrollBeginResponse(BaseModel):
    factor_id: str = Field(alias="factorId", serialization_alias="factorId")
    issuer: str
    account_name: str = Field(alias="accountName", serialization_alias="accountName")
    otpauth_url: str = Field(alias="otpauthUrl", serialization_alias="otpauthUrl")
    manual_entry_key: str = Field(alias="manualEntryKey", serialization_alias="manualEntryKey")
    expires_in: int = Field(alias="expiresIn", serialization_alias="expiresIn")
