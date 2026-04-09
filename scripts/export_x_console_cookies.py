#!/usr/bin/env python3

from __future__ import annotations

import pathlib
import runpy


def main() -> None:
    target = pathlib.Path(__file__).resolve().parent / "ui" / "export_x_console_cookies.py"
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
