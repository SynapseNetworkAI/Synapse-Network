from __future__ import annotations

from datetime import datetime

from app.services.protocol_fundamental_brief.domain import ProtocolBriefSnapshotRecord


class ProtocolBriefSnapshotCache:
    def __init__(self) -> None:
        self._entries: dict[str, ProtocolBriefSnapshotRecord] = {}

    def get(self, brief_key: str, *, now: datetime) -> ProtocolBriefSnapshotRecord | None:
        record = self._entries.get(brief_key)
        if record is None:
            return None
        if record.is_expired(now=now):
            self._entries.pop(brief_key, None)
            return None
        return record

    def put(self, record: ProtocolBriefSnapshotRecord) -> None:
        self._entries[record.brief_key] = record

    def discard(self, brief_key: str) -> None:
        self._entries.pop(brief_key, None)

    def clear(self) -> None:
        self._entries.clear()