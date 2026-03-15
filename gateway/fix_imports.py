import glob
import os

imports = """from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
"""

for fpath in glob.glob("src/domain/*.py"):
    if fpath.endswith("__init__.py") or fpath.endswith("storage_entities.py"): continue
    
    with open(fpath, "r") as f:
        content = f.read()
    
    # Simple deduplication: if it's already got BaseModel in there, remove the old ones or just string prepend and let ruff sort it out
    with open(fpath, "w") as f:
        f.write(imports + "\n" + content)
