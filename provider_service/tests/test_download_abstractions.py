from __future__ import annotations

from pathlib import Path

from app.services.asset_storage import StoredAsset
from app.services.download_abstractions import DownloadPolicy, MediaAsset


def test_download_policy_builds_namespaced_storage_key(tmp_path: Path):
    policy = DownloadPolicy(
        temp_dir=tmp_path,
        storage_prefix="downloads/2026/03/29",
        default_storage_namespace="downloads",
        max_size_bytes=1024,
    )

    assert policy.resolved_tmp_dir() == tmp_path.resolve()
    assert (
        policy.build_storage_key("github", "owner__repo", filename="asset.tar.gz")
        == "downloads/2026/03/29/github/owner__repo/asset.tar.gz"
    )


def test_media_asset_payloads_include_shared_and_video_fields():
    asset = MediaAsset.from_stored(
        StoredAsset(
            key="downloads/video.mp4",
            backend="minio",
            content_type="video/mp4",
            size_bytes=2048,
        ),
        sha256="abc123",
        duration_sec=42,
        width=1280,
        height=720,
    )

    assert asset.as_stored_payload() == {
        "storageKey": "downloads/video.mp4",
        "storageBackend": "minio",
        "mimeType": "video/mp4",
        "sizeBytes": 2048,
        "sha256": "abc123",
    }
    assert asset.as_video_payload() == {
        "storageKey": "downloads/video.mp4",
        "storageBackend": "minio",
        "mimeType": "video/mp4",
        "sizeBytes": 2048,
        "sha256": "abc123",
        "durationSec": 42,
        "width": 1280,
        "height": 720,
    }
