"""Prints a recipe's ITEM as one JSON line, for the CLI:

    blender -b --factory-startup -P item.py -- <recipe.py>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipe  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

if len(argv) != 1:
    print("usage: item.py -- <recipe.py>", file=sys.stderr)
    sys.exit(2)

try:
    module = recipe.load(argv[0])
except Exception as error:  # noqa: BLE001
    print(f"ERROR {error}", file=sys.stderr)
    sys.exit(2)

print("ITEM " + json.dumps(module.ITEM))
