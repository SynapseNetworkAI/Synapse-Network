import glob

for fpath in glob.glob("src/domain/*.py"):
    if fpath.endswith("__init__.py") or fpath.endswith("storage_entities.py"): continue
    with open(fpath, "r") as f:
        lines = f.readlines()
    
    new_lines = []
    for line in lines:
        if "from __future__ import annotations" not in line:
            new_lines.append(line)
    
    with open(fpath, "w") as f:
        f.write("from __future__ import annotations\n" + "".join(new_lines))
