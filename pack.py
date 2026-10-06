"""Zip this module into <id>.zip next to module.json, the file its "download"
URL points at.

Usage: python pack.py

The zip holds module.json, scripts/ and styles/ at its top level, which is
the layout Foundry's installer expects. Bump "version" in module.json before
packing an update, or Foundry will not offer it.
"""
import json, os, zipfile

root = os.path.dirname(os.path.abspath(__file__))
manifest = json.load(open(os.path.join(root, "module.json"), encoding="utf8"))
out = os.path.join(root, f"{manifest['id']}.zip")

files = ["module.json"]
for sub in ("scripts", "styles", "lang", "templates"):
    for base, _, names in os.walk(os.path.join(root, sub)):
        files += [os.path.relpath(os.path.join(base, n), root).replace("\\", "/") for n in sorted(names)]

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(root, f), f)
print(f"{out}  v{manifest['version']}  ({len(files)} files: {', '.join(files)})")
