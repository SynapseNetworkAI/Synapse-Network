from __future__ import annotations


class ReplayAwareRepository:
    """Test helper that forces a cache miss on the first lookup, then replays the stored snapshot."""

    def __init__(self, stored_repo, *, force_first_miss: bool = True) -> None:
        self._stored_repo = stored_repo
        self.invocations = stored_repo.invocations
        self._first_lookup = force_first_miss

    def save_asset(self, record) -> None:
        self._stored_repo.save_asset(record)

    def load_asset(self, asset_key: str):
        if self._first_lookup:
            self._first_lookup = False
            return None
        return self._stored_repo.load_asset(asset_key)

    def append_invocation(self, record) -> None:
        self._stored_repo.append_invocation(record)
