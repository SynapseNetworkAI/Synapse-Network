# pyright: reportMissingImports=false

import asyncio
from pathlib import Path
import sys

import pytest

from app.services.download_abstractions import DownloadPolicy, run_guarded_download
from app.services.yt_dlp_subprocess import YtDlpSubprocessSpec, run_yt_dlp_subprocess


def test_run_guarded_download_disconnect_cancels_operation():
    cancelled = False

    async def _operation():
        nonlocal cancelled
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            cancelled = True
            raise

    async def _disconnect_checker() -> bool:
        return True

    with pytest.raises(ValueError, match="DOWNLOAD_CANCELLED"):
        asyncio.run(
            run_guarded_download(
                service_key="svc_test_download",
                policy=DownloadPolicy(
                    temp_dir=Path("."),
                    storage_prefix="test",
                    default_storage_namespace="test",
                    concurrency_limit=1,
                ),
                timeout_error_code="DOWNLOAD_TIMEOUT",
                disconnect_error_code="DOWNLOAD_CANCELLED",
                disconnect_checker=_disconnect_checker,
                operation=_operation,
            )
        )

    assert cancelled is True


def test_run_yt_dlp_subprocess_success(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    script = (
        "import json,sys;"
        "json.loads(sys.stdin.read());"
        "print(json.dumps({'ok': True, 'info': {'id': 'demo', 'filepath': sys.argv[1]}}))"
    )
    target_path = tmp_path / "demo.mp4"

    monkeypatch.setattr(
        "app.services.yt_dlp_subprocess._worker_command",
        lambda: [sys.executable, "-c", script, str(target_path)],
    )

    result = asyncio.run(
        run_yt_dlp_subprocess(
            YtDlpSubprocessSpec(
                url="https://example.com/video",
                target_dir=tmp_path,
                format_selector="best",
                download=False,
            )
        )
    )

    assert result["id"] == "demo"
    assert result["filepath"] == str(target_path)


def test_run_yt_dlp_subprocess_cancel_terminates_worker(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    marker = tmp_path / "terminated.txt"
    script = """
import pathlib
import signal
import sys
import time

marker = pathlib.Path(sys.argv[1])

def _handle_sigterm(signum, frame):
    marker.write_text("terminated", encoding="utf-8")
    sys.exit(0)

signal.signal(signal.SIGTERM, _handle_sigterm)
sys.stdin.read()
time.sleep(10)
"""

    monkeypatch.setattr(
        "app.services.yt_dlp_subprocess._worker_command",
        lambda: [sys.executable, "-c", script, str(marker)],
    )

    async def _run() -> None:
        task = asyncio.create_task(
            run_yt_dlp_subprocess(
                YtDlpSubprocessSpec(
                    url="https://example.com/video",
                    target_dir=tmp_path,
                    format_selector="best",
                    download=True,
                )
            )
        )
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(_run())
    assert marker.read_text(encoding="utf-8") == "terminated"
