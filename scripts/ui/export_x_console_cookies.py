#!/usr/bin/env python3
"""Export authenticated X Console cookies from local Chrome for Playwright."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _load_browser_cookie3():
    try:
        import browser_cookie3  # type: ignore
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SystemExit(
            "Missing dependency: browser_cookie3. Install with "
            "`python -m pip install --user browser-cookie3`."
        ) from exc
    return browser_cookie3


def _same_site(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.lower()
    if normalized == "lax":
        return "Lax"
    if normalized == "strict":
        return "Strict"
    if normalized == "none":
        return "None"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export x.com / console.x.com cookies for Playwright."
    )
    parser.add_argument(
        "--output",
        default="/tmp/x_console_cookies.json",
        help="Where to write the Playwright cookie JSON.",
    )
    args = parser.parse_args()

    browser_cookie3 = _load_browser_cookie3()
    jar = browser_cookie3.chrome(domain_name=".x.com")

    cookies: list[dict[str, object]] = []
    for cookie in jar:
        if "x.com" not in cookie.domain:
            continue

        entry: dict[str, object] = {
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path,
            "secure": bool(cookie.secure),
            "httpOnly": "httponly" in cookie._rest,
        }
        if cookie.expires:
            entry["expires"] = float(cookie.expires)
        same_site = _same_site(cookie._rest.get("SameSite"))
        if same_site:
            entry["sameSite"] = same_site
        cookies.append(entry)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(cookies, indent=2), encoding="utf-8")
    print(f"Exported {len(cookies)} cookies to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
