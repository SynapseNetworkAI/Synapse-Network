from __future__ import annotations

from datetime import UTC, datetime
import hashlib

from pydantic import BaseModel, ConfigDict

from app.schemas.oss_security_healthcheck import (
    OSSSecurityHealthcheckRequest,
    OSSSecurityHealthcheckResponse,
)


def parse_zulu_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def build_report_key(payload: OSSSecurityHealthcheckRequest) -> str:
    repo = payload.repo_url or ""
    packages = ",".join(payload.package_list)
    digest = hashlib.sha256(f"{repo}:{packages}:{payload.ecosystem}".encode("utf-8")).hexdigest()[:24]
    return f"oss__{digest}"


class OSSSecurityReportRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    report_key: str
    request: OSSSecurityHealthcheckRequest
    response: OSSSecurityHealthcheckResponse
    expires_at: str | None = None

    def is_expired(self, *, now: datetime) -> bool:
        if self.expires_at is None:
            return False
        return parse_zulu_datetime(self.expires_at) <= now

    def as_cache_hit_response(self) -> OSSSecurityHealthcheckResponse:
        freshness = self.response.freshness.model_copy(update={"cache_hit": True})
        return self.response.model_copy(update={"freshness": freshness})
