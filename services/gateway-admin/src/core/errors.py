from dataclasses import dataclass


@dataclass(slots=True)
class AppError(Exception):
    code: str
    message: str
    status_code: int
    data: object | None = None

    def __str__(self) -> str:
        return self.message


class AuthenticationError(AppError):
    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(code="UNAUTHORIZED", message=message, status_code=401)


class AdminAccountLockedError(AppError):
    def __init__(
        self,
        message: str = "Admin account is temporarily locked. Try later or contact an owner.",
    ) -> None:
        super().__init__(code="ADMIN_ACCOUNT_LOCKED", message=message, status_code=423)


class AuthorizationError(AppError):
    def __init__(self, message: str = "Permission denied") -> None:
        super().__init__(code="FORBIDDEN", message=message, status_code=403)


class ResourceNotFoundError(AppError):
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(code="NOT_FOUND", message=message, status_code=404)


class BadRequestError(AppError):
    def __init__(self, message: str = "Invalid request") -> None:
        super().__init__(code="BAD_REQUEST", message=message, status_code=400)


class MfaEnrollmentRequiredError(AppError):
    def __init__(self, data: object, message: str = "MFA enrollment required") -> None:
        super().__init__(code="MFA_ENROLLMENT_REQUIRED", message=message, status_code=428, data=data)
