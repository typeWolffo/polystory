"""Renders a built GLB for a look. The CLI passes one JSON argument:

    blender -b --factory-startup [rig.blend] -P preview.py -- '<json>'

mount "socket": the item hangs under the rig object named `socket`.
mount "beside": the item floats at `socket` + `offset`, scaled from its own
units into the rig's, as a prop about to be thrown.
mount "turntable": no rig; the item stands on a checker floor.
Output: <out>/<item>_<view>.png, and ref_<ref>_<view>.png when a reference
object from the rig file is named. The rig file is never saved.
"""
import json
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []

if len(argv) != 1:
    print("usage: preview.py -- '<json config>'", file=sys.stderr)
    sys.exit(2)

cfg = json.loads(argv[0])
glb, out_dir, mount = cfg["glb"], cfg["out"], cfg["mount"]
rig = cfg.get("rig") or {}
item_name = os.path.splitext(os.path.basename(glb))[0]

if mount != "turntable":
    for name in rig.get("hideCollections", []):
        col = bpy.data.collections.get(name)

        if col is None:
            print(f"WARN rig has no collection {name!r}")
            continue

        for child in [col, *col.children_recursive]:
            for o in child.objects:
                o.hide_render = True

socket = bpy.data.objects.get(cfg["socket"]) if cfg.get("socket") else None

if mount != "turntable" and socket is None:
    print(f"ERROR no object {cfg.get('socket')!r} in the rig file", file=sys.stderr)
    sys.exit(2)

scene = render.setup(cfg.get("samples", 16))
bpy.ops.import_scene.gltf(filepath=glb)
imported = [o for o in bpy.context.selected_objects if o.type == "MESH"]

if not imported:
    print("ERROR the GLB imported no mesh", file=sys.stderr)
    sys.exit(2)

rig_units = float(rig.get("unitsPerMetre") or cfg["unitsPerMetre"])
item_units = float(cfg["unitsPerMetre"])
into_rig = rig_units / item_units


def mount_on(obj):
    obj.parent = socket
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = Matrix.Scale(into_rig, 4)
    obj.hide_render = False


def hold(obj):
    offset = Vector(cfg.get("offset", [-0.3, -0.2, 0.15]))
    obj.matrix_world = Matrix.Translation(socket.matrix_world.translation + offset) @ Matrix.Scale(into_rig, 4)
    obj.hide_render = False


for o in imported:
    if mount == "socket":
        mount_on(o)
    elif mount == "beside":
        hold(o)
    else:
        o.hide_render = False

bpy.context.view_layer.update()
cam = render.camera(scene)
lo, hi = render.bounds_of(imported)
item_centre = (lo + hi) / 2
item_extent = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)

if mount == "turntable":
    floor_z = lo.z
    cell = 0.1 * item_units
    render.grid_floor(scene, floor_z - 0.001 * item_units, cell, max(item_extent * 4, cell * 10))

    if cfg.get("scaleFigure"):
        render.scale_figure(scene, 1.75 * item_units, Vector((lo.x - item_extent * 0.6 - 0.2 * item_units, item_centre.y, floor_z)))

    render.lights(scene, item_centre, item_extent)
    views = render.turntable_views(lo, hi)
else:
    visible = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render and o not in imported]
    rig_lo, rig_hi = render.bounds_of(visible)
    rig_centre = (rig_lo + rig_hi) / 2
    rig_height = max((rig_hi - rig_lo).z, 1e-3)
    render.lights(scene, rig_centre, rig_height / 2)
    far = cfg.get("farMetres", 7) * rig_units
    views = [
        ("close", item_centre, max(item_extent * 2.6, rig_height * 0.25), 30.0, 10.0, 50, (900, 700)),
        ("figure", rig_centre, rig_height * 1.35, 28.0, 8.0, 42, (700, 900)),
        ("far", rig_centre, far, 36.0, 12.0, 35, (900, 640)),
    ]

render.shoot(scene, cam, views, out_dir, item_name)
ref_name = cfg.get("ref")

if ref_name:
    ref = bpy.data.objects.get(ref_name)

    if ref is None:
        print(f"ERROR no object {ref_name!r} in the rig file", file=sys.stderr)
        sys.exit(2)

    for o in imported:
        o.hide_render = True

    if ref.modifiers or ref.parent is not None:
        ref.hide_render = False
    elif mount == "socket":
        ref.parent = socket
        ref.matrix_parent_inverse = Matrix.Identity(4)
        ref.matrix_basis = Matrix.Identity(4)
        ref.hide_render = False
    else:
        ref.hide_render = False

    bpy.context.view_layer.update()
    r_lo, r_hi = render.bounds_of([ref])
    r_centre = (r_lo + r_hi) / 2
    r_extent = max((r_hi - r_lo).x, (r_hi - r_lo).y, (r_hi - r_lo).z, 1e-3)
    views[0] = ("close", r_centre, max(r_extent * 2.6, rig_height * 0.25), 30.0, 10.0, 50, (900, 700))
    render.shoot(scene, cam, views, out_dir, f"ref_{ref_name}")
