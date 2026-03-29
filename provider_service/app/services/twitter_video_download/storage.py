from __future__ import annotations

from app.services.asset_storage import (
    MinioStorageGateway,
    StorageGateway,
    StoredAsset,
    build_storage_gateway,
)


VideoStorage = StorageGateway
MinioVideoStorage = MinioStorageGateway
StoredObject = StoredAsset


def build_video_storage() -> VideoStorage:
    return build_storage_gateway()
