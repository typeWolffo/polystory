"""Build helpers a recipe sees as its `kit`: primitives, bevel, smoothing,
palette materials and the GLB export. Runs inside Blender; build.py
configures it with the project's style before a recipe runs.

A recipe is modelled +Z up, -Y forward, in the units its kind declares
(metres, or a rig's units); the export turns +Z into glTF's +Y.
"""
import bmesh
import bpy
import math
import os
from mathutils import Matrix, Vector

MATERIALS = {}
KNOBS = {
    "bevel": 0.02,
    "bevelSegments": 2,
    "segments": 32,
    "sphere": [24, 12],
    "smooth": True,
    "smoothAngle": 45.0,
    "minThickness": 0.02,
}


def configure(materials, knobs):
    MATERIALS.clear()
    MATERIALS.update(materials)
    KNOBS.update({k: v for k, v in knobs.items() if v is not None})


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name):
    spec = MATERIALS.get(name)

    if spec is None:
        raise ValueError(f"material {name!r} is not in the style's palette ({', '.join(sorted(MATERIALS)) or 'empty'})")

    mat = bpy.data.materials.get(name)

    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        h = spec["hex"].lstrip("#")
        rgb = [srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = float(spec["roughness"])
        bsdf.inputs["Metallic"].default_value = float(spec.get("metallic", 0.0))

        if spec.get("emissive"):
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
            bsdf.inputs["Emission Strength"].default_value = float(spec["emissive"])

        mat.diffuse_color = (*rgb, 1.0)
        mat.roughness = float(spec["roughness"])

    return mat


def _placement(x, y, z, rot):
    rx, ry, rz = (math.radians(a) for a in rot)

    return Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")


def _knob(value, key):
    return KNOBS[key] if value is None else value


class Kit:
    """Every primitive takes a palette material name and lands in the item's
    own space. `bevel`, `segments` and `bevel_segments` default to the
    style's knobs; pass a number to override one call."""

    def __init__(self):
        self.parts = []

    def _add(self, bm, mat, bevel, segments, smooth=None):
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, profile=0.7, affect="EDGES", clamp_overlap=True)

        shade = KNOBS["smooth"] if smooth is None else smooth

        for f in bm.faces:
            f.smooth = shade

        self.parts.append((bm, mat))

    def cylinder(self, r, h, x=0.0, y=0.0, z=0.0, mat="base", bevel=None, segments=None, rot=(0, 0, 0), bevel_segments=None):
        """A cylinder standing on z (its base), radius r, height h."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=_knob(segments, "segments"), radius1=r, radius2=r, depth=h, matrix=_placement(x, y, z + h / 2, rot))
        self._add(bm, mat, _knob(bevel, "bevel"), _knob(bevel_segments, "bevelSegments"))

    def cone(self, r1, r2, h, x=0.0, y=0.0, z=0.0, mat="base", bevel=None, segments=None, rot=(0, 0, 0), bevel_segments=None):
        """A truncated cone standing on z: radius r1 at the base, r2 at the top (0 for a point)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=_knob(segments, "segments"), radius1=r1, radius2=max(r2, 0.0), depth=h, matrix=_placement(x, y, z + h / 2, rot))
        self._add(bm, mat, _knob(bevel, "bevel"), _knob(bevel_segments, "bevelSegments"))

    def sphere(self, r, x=0.0, y=0.0, z=0.0, mat="base", u=None, v=None, scale=(1, 1, 1)):
        """A UV sphere centred on (x, y, z); scale squashes it into an egg or a disc."""
        bm = bmesh.new()
        m = Matrix.Translation((x, y, z)) @ Matrix.Diagonal((*scale, 1.0))
        su, sv = KNOBS["sphere"]
        bmesh.ops.create_uvsphere(bm, u_segments=su if u is None else u, v_segments=sv if v is None else v, radius=r, matrix=m)
        self._add(bm, mat, 0.0, 0)

    def box(self, sx, sy, sz, x=0.0, y=0.0, z=0.0, mat="base", bevel=None, rot=(0, 0, 0), bevel_segments=None):
        """A box of size (sx, sy, sz) centred on (x, y, z)."""
        bm = bmesh.new()
        m = _placement(x, y, z, rot) @ Matrix.Diagonal((sx, sy, sz, 1.0))
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        self._add(bm, mat, _knob(bevel, "bevel"), _knob(bevel_segments, "bevelSegments"))

    def torus(self, R, r, x=0.0, y=0.0, z=0.0, mat="base", segments=None, minor=10, rot=(0, 0, 0)):
        """A ring of major radius R and tube radius r, lying flat (axis +Z) before rot."""
        bm = bmesh.new()
        m = _placement(x, y, z, rot)
        n = _knob(segments, "segments")
        verts = []

        for i in range(n):
            a = 2 * math.pi * i / n
            ring = []

            for j in range(minor):
                b = 2 * math.pi * j / minor
                p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                ring.append(bm.verts.new(m @ p))

            verts.append(ring)

        for i in range(n):
            for j in range(minor):
                a, b = verts[i][j], verts[i][(j + 1) % minor]
                c, d = verts[(i + 1) % n][(j + 1) % minor], verts[(i + 1) % n][j]
                bm.faces.new((a, b, c, d))

        bm.normal_update()
        self._add(bm, mat, 0.0, 0)

    def tube(self, points, r, mat="base", segments=12):
        """A smooth tube along a polyline of (x, y, z) points, for straps, stems and wires."""
        bm = bmesh.new()
        pts = [Vector(p) for p in points]
        tangents = []

        for i in range(len(pts)):
            axis = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            tangents.append(axis.normalized() if axis.length > 1e-9 else Vector((0, 0, 1)))

        # Rotation-minimising frames: each ring's normal is the previous one
        # carried over by the smallest rotation between the two tangents, so
        # the tube does not twist where it runs along the up axis.
        helper = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        normal = tangents[0].cross(helper).normalized()
        rings = []

        for i, (p, t) in enumerate(zip(pts, tangents)):
            if i > 0:
                swing = tangents[i - 1].cross(t)

                if swing.length > 1e-9:
                    normal = Matrix.Rotation(tangents[i - 1].angle(t), 3, swing) @ normal

                normal = (normal - t * normal.dot(t)).normalized()

            binormal = t.cross(normal)
            ring = []

            for j in range(segments):
                b = 2 * math.pi * j / segments
                ring.append(bm.verts.new(p + normal * (r * math.cos(b)) + binormal * (r * math.sin(b))))

            rings.append(ring)

        for i in range(len(rings) - 1):
            for j in range(segments):
                bm.faces.new((rings[i][j], rings[i][(j + 1) % segments], rings[i + 1][(j + 1) % segments], rings[i + 1][j]))

        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        bm.normal_update()
        self._add(bm, mat, 0.0, 0)


def assemble(kit, name, smooth_angle=None):
    """Joins every part into one mesh object at the origin, one material slot
    per palette name, sharp edges above the smooth angle (or every face flat
    when the style is flat shaded)."""
    mesh = bpy.data.meshes.new(name)
    merged = bmesh.new()
    mats = []

    for bm, mat in kit.parts:
        if mat not in mats:
            mats.append(mat)

        idx = mats.index(mat)
        copies = {v: merged.verts.new(v.co) for v in bm.verts}

        for f in bm.faces:
            nf = merged.faces.new([copies[v] for v in f.verts])
            nf.smooth = f.smooth
            nf.material_index = idx

        bm.free()

    merged.normal_update()
    threshold = math.radians(KNOBS["smoothAngle"] if smooth_angle is None else smooth_angle)

    for e in merged.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > threshold:
            e.smooth = False

    merged.to_mesh(mesh)
    merged.free()

    for m in mats:
        mesh.materials.append(material(m))

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)

    return obj


def export_glb(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_extras=False,
    )


def stats(obj):
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]

    return {
        "tris": tris,
        "verts": len(me.vertices),
        "materials": [m.name for m in me.materials],
        "min": [round(min(xs), 3), round(min(ys), 3), round(min(zs), 3)],
        "max": [round(max(xs), 3), round(max(ys), 3), round(max(zs), 3)],
    }
