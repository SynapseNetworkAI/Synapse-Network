from __future__ import annotations

import asyncio
from asyncio.subprocess import Process
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import sys


@dataclass(frozen=True)
class YtDlpSubprocessSpec:
    url: str
    target_dir: Path
    format_selector: str
    merge_output_format: str = "mp4"
    socket_timeout_s: int = 20
    download: bool = True

    def output_template(self) -> str:
        return str(Path(self.target_dir).resolve() / "%(id)s.%(ext)s")

    def as_payload(self) -> dict[str, object]:
        return {
            "url": self.url,
            "targetDir": str(Path(self.target_dir).resolve()),
            "formatSelector": self.format_selector,
            "mergeOutputFormat": self.merge_output_format,
            "socketTimeoutSec": self.socket_timeout_s,
            "download": self.download,
            "outputTemplate": self.output_template(),
        }


def _provider_service_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _worker_command() -> list[str]:
    return [sys.executable, "-m", "app.services.yt_dlp_worker"]


def _parse_worker_response(raw_output: str) -> dict[str, object] | None:
    normalized = raw_output.strip()
    if not normalized:
        return None

    for line in reversed(normalized.splitlines()):
        candidate = line.strip()
        if not candidate or not candidate.startswith("{"):
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


async def _terminate_process(process: Process) -> None:
    if process.returncode is not None:
        return

    try:
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        await asyncio.wait_for(process.wait(), timeout=2)
    except (ProcessLookupError, asyncio.TimeoutError):
        if process.returncode is None:
            try:
                if os.name != "nt":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
            except ProcessLookupError:
                return
            await process.wait()


async def run_yt_dlp_subprocess(spec: YtDlpSubprocessSpec) -> dict[str, object]:
    process = await asyncio.create_subprocess_exec(
        *_worker_command(),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(_provider_service_root()),
        start_new_session=(os.name != "nt"),
    )
    try:
        stdout, stderr = await process.communicate(
            json.dumps(spec.as_payload(), ensure_ascii=False).encode("utf-8")
        )
    except asyncio.CancelledError:
        await _terminate_process(process)
        raise

    stdout_text = stdout.decode("utf-8").strip()
    stderr_text = stderr.decode("utf-8").strip()
    response = _parse_worker_response(stdout_text)
    if response is None:
        response = _parse_worker_response(stderr_text)

    if process.returncode != 0:
        error_message = stderr_text
        if response and isinstance(response.get("error"), str):
            error_message = str(response["error"])
        raise RuntimeError(error_message or "yt_dlp subprocess failed")

    if not response or response.get("ok") is not True or not isinstance(response.get("info"), dict):
        raise RuntimeError("yt_dlp subprocess returned malformed response")
    return response["info"]
