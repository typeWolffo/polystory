"""Builds the calibration set under one direction's knobs and palette and
renders it on a turntable, so a look can be chosen from pictures:

    blender -b --factory-startup -P calibrate.py -- <calibration.py> <out dir> '<json direction>'
"""
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipe  # noqa: E402
import render  # noqa: E402
import toolkit  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

if len(argv) != 3:
    print("usage: calibrate.py -- <calibration.py> <out dir> '<json>'", file=sys.stderr)
    sys.exit(2)

recipe_path, out_dir, direction = argv[0], argv[1], json.loads(argv[2])
module = recipe.load(recipe_path)
toolkit.configure(direction["materials"], direction["knobs"])
bpy.ops.wm.read_factory_settings(use_empty=True)
kit = toolkit.Kit()
module.build(kit)
obj = toolkit.assemble(kit, f"calibration_{direction['name']}")
os.makedirs(out_dir, exist_ok=True)
glb = os.path.join(out_dir, "calibration.glb")
toolkit.export_glb(obj, glb)
info = toolkit.stats(obj)
info["file"] = glb
info["bytes"] = os.path.getsize(glb)
print("BUILT " + json.dumps(info))

scene = render.setup(24)
lo, hi = render.bounds_of([obj])
centre = (lo + hi) / 2
extent = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
render.grid_floor(scene, lo.z - 0.001, 0.1, max(extent * 4, 2.0))
render.lights(scene, centre, extent)
cam = render.camera(scene)
views = render.turntable_views(lo, hi)
views[0] = ("front", centre, extent * 2.0, 8.0, 14.0, 50, (1200, 700))
render.shoot(scene, cam, views[:2], out_dir, direction["name"])
