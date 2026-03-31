from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any


def _normalize_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _serialize_requested_entries(entries: object) -> list[dict[str, object]]:
    serialized: list[dict[str, object]] = []
    if not isinstance(entries, list):
        return serialized
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        serialized.append(
            {
                "filepath": entry.get("filepath"),
                "filesize": _normalize_int(entry.get("filesize")),
                "filesize_approx": _normalize_int(entry.get("filesize_approx")),
            }
        )
    return serialized


def _serialize_info(info: dict[str, Any], *, target_dir: Path) -> dict[str, object]:
    requested_downloads = _serialize_requested_entries(info.get("requested_downloads"))
    requested_formats = _serialize_requested_entries(info.get("requested_formats"))
    file_path = None
    if requested_downloads:
        file_path = requested_downloads[0].get("filepath")
    if not file_path:
        ext = str(info.get("ext") or "bin")
        file_path = str(target_dir / f"{info.get('id')}.{ext}")

    return {
        "id": str(info.get("id") or ""),
        "duration": _normalize_int(info.get("duration")),
        "width": _normalize_int(info.get("width")),
        "height": _normalize_int(info.get("height")),
        "ext": str(info.get("ext") or ""),
        "filepath": file_path,
        "filesize": _normalize_int(info.get("filesize")),
        "filesize_approx": _normalize_int(info.get("filesize_approx")),
        "requested_downloads": requested_downloads,
        "requested_formats": requested_formats,
        "subreddit": str(info.get("subreddit") or ""),
        "uploader": str(info.get("uploader") or ""),
        "uploader_id": str(info.get("uploader_id") or ""),
        "timestamp": _normalize_int(info.get("timestamp")),
    }


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        target_dir = Path(payload["targetDir"]).resolve()
        target_dir.mkdir(parents=True, exist_ok=True)

        from yt_dlp import YoutubeDL

        options = {
            "outtmpl": payload["outputTemplate"],
            "format": payload["formatSelector"],
            "merge_output_format": payload.get("mergeOutputFormat", "mp4"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "socket_timeout": int(payload.get("socketTimeoutSec", 20)),
        }

        with YoutubeDL(options) as ydl:
            info = ydl.extract_info(
                str(payload["url"]),
                download=bool(payload.get("download", True)),
            )

        sys.stdout.write(json.dumps({"ok": True, "info": _serialize_info(info, target_dir=target_dir)}))
        return 0
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
