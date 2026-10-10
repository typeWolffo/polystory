"""Builds one recipe into a GLB, headless. The CLI composes the call:

    blender -b --factory-startup -P build.py -- <recipe.py> <out.glb> '<json: knobs, materials, item>'

Prints `BUILT {...}` with the triangle count, the bounds and the materials.
A build that errors leaves no file behind.
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipe  # noqa: E402
import toolkit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

if len(argv) != 3:
    print("usage: build.py -- <recipe.py> <out.glb> <json>", file=sys.stderr)
    sys.exit(2)

recipe_path, out_path, spec = os.path.abspath(argv[0]), os.path.abspath(argv[1]), json.loads(argv[2])

try:
    module = recipe.load(recipe_path)
except Exception as error:  # noqa: BLE001
    print(f"ERROR {error}", file=sys.stderr)
    sys.exit(2)

item = module.ITEM
toolkit.configure(spec["materials"], spec["knobs"])
bpy.ops.wm.read_factory_settings(use_empty=True)
kit = toolkit.Kit()

try:
    module.build(kit)
except Exception as error:  # noqa: BLE001
    print(f"ERROR the recipe failed: {error}", file=sys.stderr)
    raise

if not kit.parts:
    print("ERROR the recipe built nothing", file=sys.stderr)
    sys.exit(2)

obj = toolkit.assemble(kit, item["id"], item.get("smooth_angle"))
toolkit.export_glb(obj, out_path)
info = toolkit.stats(obj)
info["file"] = out_path
info["bytes"] = os.path.getsize(out_path)
print("BUILT " + json.dumps(info))
