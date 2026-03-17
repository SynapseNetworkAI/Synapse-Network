from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")


def iter_markdown_files(repo_root: Path) -> list[Path]:
    files = set(repo_root.glob("docs/**/*.md"))
    files.update(repo_root.glob("admin/gateway-admin/docs/**/*.md"))
    files.update(repo_root.glob("README.md"))
    files.update(repo_root.glob("docs/*.md"))
    return sorted(path for path in files if path.is_file())


def should_skip(target: str) -> bool:
    return (
        not target
        or target.startswith("#")
        or "://" in target
        or target.startswith("mailto:")
        or target.startswith("tel:")
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    missing: list[str] = []

    for markdown_file in iter_markdown_files(repo_root):
        content = markdown_file.read_text(encoding="utf-8")
        for raw_target in LINK_RE.findall(content):
            target = raw_target.strip()
            if should_skip(target):
                continue

            target_without_anchor = target.split("#", 1)[0].strip()
            if should_skip(target_without_anchor):
                continue

            resolved = (markdown_file.parent / unquote(target_without_anchor)).resolve()
            if not resolved.exists():
                missing.append(f"{markdown_file.relative_to(repo_root)} -> {target}")

    if missing:
        print("Broken relative markdown links detected:", file=sys.stderr)
        for item in missing:
            print(f" - {item}", file=sys.stderr)
        return 1

    print("Markdown relative links check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())