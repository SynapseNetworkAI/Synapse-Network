from __future__ import annotations

from app.services.asset_storage import AssetStorage, MinioAssetStorage, StoredObject, build_asset_storage


VideoStorage = AssetStorage
MinioVideoStorage = MinioAssetStorage


def build_video_storage() -> VideoStorage:
    return build_asset_storage()
