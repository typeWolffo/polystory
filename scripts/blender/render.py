"""Scene, lights, camera and the floor grid shared by preview.py and
calibrate.py. Everything is sized from what is in frame, so the same views
work for a 3 cm gem and a 3 m prop."""
import math
import os

import bpy
from mathutils import Vector


def setup(samples):
    scene = bpy.context.scene

    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue

    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = int(samples)

    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("polystory_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.035, 0.035, 0.04, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    for o in list(bpy.data.objects):
        if o.type == "LIGHT":
            o.hide_render = True

    return scene


def _light(scene, name, kind, energy, color, location, size=2.0):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = color

    if kind == "AREA":
        data.size = size

    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (-Vector(location)).to_track_quat("-Z", "Y").to_euler()

    return light


def lights(scene, around, radius):
    """Three-point lighting scaled to the subject: `around` is its centre,
    `radius` roughly its size."""
    r = max(radius, 0.05)
    _light(scene, "polystory_key", "SUN", 3.0, (1.0, 0.97, 0.92), around + Vector((-2.5, -3.0, 5.0)) * r)
    _light(scene, "polystory_fill", "AREA", 120.0 * r * r, (0.8, 0.85, 1.0), around + Vector((3.0, -2.5, 2.5)) * r, size=3.0 * r)
    _light(scene, "polystory_rim", "AREA", 160.0 * r * r, (1.0, 1.0, 1.0), around + Vector((0.0, 3.0, 3.0)) * r, size=2.0 * r)


def camera(scene):
    data = bpy.data.cameras.new("polystory_cam")
    data.sensor_width = 36
    cam = bpy.data.objects.new("polystory_cam", data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    return cam


def bounds_of(objects):
    pts = []

    for o in objects:
        if o.type != "MESH":
            continue

        for corner in o.bound_box:
            pts.append(o.matrix_world @ Vector(corner))

    if not pts:
        return Vector((0, 0, 0)), Vector((0, 0, 0))

    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))

    return lo, hi


def grid_floor(scene, z, cell, span):
    """A checker floor with `cell`-sized squares, for scale in a turntable."""
    mesh = bpy.data.meshes.new("polystory_floor")
    mesh.from_pydata([(-span, -span, z), (span, -span, z), (span, span, z), (-span, span, z)], [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("polystory_floor", mesh)
    scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("polystory_floor")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    checker = nodes.new("ShaderNodeTexChecker")
    checker.inputs["Color1"].default_value = (0.09, 0.09, 0.1, 1)
    checker.inputs["Color2"].default_value = (0.13, 0.13, 0.145, 1)
    checker.inputs["Scale"].default_value = 1.0
    coords = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / cell, 1 / cell, 1 / cell)
    links.new(coords.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], checker.inputs["Vector"])
    links.new(checker.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    mesh.materials.append(mat)

    return obj


def scale_figure(scene, height, at):
    """A featureless person-shaped capsule of `height`, for scale."""
    r = height * 0.11
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=height - 2 * r, location=(at.x, at.y, at.z + height / 2))
    body = bpy.context.active_object
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(at.x, at.y, at.z + height - r))
    head = bpy.context.active_object
    mat = bpy.data.materials.new("polystory_figure")
    mat.diffuse_color = (0.25, 0.25, 0.28, 1)
    mat.use_nodes = True
    next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.25, 0.25, 0.28, 1)

    for o in (body, head):
        o.data.materials.append(mat)
        bpy.ops.object.shade_smooth()

    return [body, head]


def shoot(scene, cam, views, out_dir, prefix):
    """views: list of (name, target Vector, distance, yaw°, pitch°, lens mm, (w, h))."""
    os.makedirs(out_dir, exist_ok=True)

    for name, at, dist, yaw, pitch, lens, res in views:
        yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
        direction = Vector((math.sin(yaw_r) * math.cos(pitch_r), -math.cos(yaw_r) * math.cos(pitch_r), math.sin(pitch_r)))
        cam.location = at + direction * dist
        cam.rotation_euler = (at - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens
        cam.data.clip_start = max(dist * 0.01, 0.001)
        cam.data.clip_end = dist * 50
        scene.render.resolution_x, scene.render.resolution_y = res
        scene.render.filepath = os.path.join(out_dir, f"{prefix}_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


def turntable_views(lo, hi):
    """Three views framing an item that stands on the floor at z = lo.z."""
    centre = (lo + hi) / 2
    extent = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1e-3)
    d = extent * 2.4

    return [
        ("front", centre, d, 0.0, 12.0, 50, (800, 800)),
        ("quarter", centre, d, 40.0, 22.0, 50, (800, 800)),
        ("top", centre, d, 20.0, 58.0, 50, (800, 800)),
    ]
