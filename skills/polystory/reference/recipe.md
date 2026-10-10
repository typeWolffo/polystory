# A recipe

One Python file, `recipes/<model>.py`, run inside Blender by
`polystory build`. It defines `ITEM` and `build(kit)` and nothing else
is read.

```python
"""A bucket hat. z = 0 is the hat line on the head, +Z up, -Y the face."""

ITEM = {
    "kind": "accessory",        # a kind from profile.json
    "id": "hat_bucket",         # the object's name in the file, and the catalog id
    "slot": "hat",              # a slotted kind only
    "model": "hats/bucket",     # the file key: models/<model>.glb, recipes/<model>.py
    "pl": "Kapelusz rybacki",   # anything the register command's placeholders need
    "en": "Bucket hat",
    "smooth_angle": 45,         # optional, overrides the style's knob for this item
}


def build(kit):
    kit.cylinder(r=0.74, h=0.05, z=-0.03, mat="acc_teal")
    kit.cone(r1=0.55, r2=0.5, h=0.32, z=0.1, mat="acc_teal")
    kit.sphere(r=0.5, z=0.42, mat="acc_teal", scale=(1, 1, 0.22))
    kit.torus(R=0.56, r=0.025, z=0.1, mat="acc_cream", minor=8)
```

## Frame

+Z up, -Y forward (the face, the direction a prop is thrown), +X the
subject's left. The export turns +Z into glTF's +Y. Units are the kind's:
metres, or a rig's units. The origin is what the code attaches: the socket
for a slotted item (model straight, the socket does the leaning), the
pivot for a prop (the centre of a ball, the point of impact of a splat,
the floor under a standing piece).

## The kit

Every primitive takes `mat`, a material name from `style.json`, and lands
in the item's space. `bevel`, `segments`, `bevel_segments`, `u`, `v`
default to the style's knobs; pass a number to override one call.

| Call | Shape |
| --- | --- |
| `cylinder(r, h, x, y, z, mat, bevel, segments, rot, bevel_segments)` | standing on z, its base; height h |
| `cone(r1, r2, h, …)` | truncated cone standing on z; `r2=0` for a point |
| `sphere(r, x, y, z, mat, u, v, scale)` | UV sphere centred on (x, y, z); `scale=(1, 1, 0.3)` is a disc |
| `box(sx, sy, sz, x, y, z, mat, bevel, rot, bevel_segments)` | centred on (x, y, z) |
| `torus(R, r, x, y, z, mat, segments, minor, rot)` | a ring, flat (axis +Z) before `rot` |
| `tube(points, r, mat, segments)` | a smooth tube along a polyline: straps, stems, wires, fuses |

`rot` is `(rx, ry, rz)` in degrees, applied Z then Y then X around the
part's own origin before it moves to (x, y, z). Scale is baked into the
primitive before the bevel, so the bevel is the same width on every side;
the bug this prevents is a dome cut before its scale is applied.

`build(kit)` returns nothing; the parts are joined into one mesh named
`ITEM["id"]`, one material slot per palette name, every face smooth with
edges sharper than the smooth angle marked sharp (or every face flat when
the style says so), then exported with `export_apply`, Y-up, no texcoords,
no skins, no animation.

## Knobs, and what they do

| Knob | Effect |
| --- | --- |
| `bevel`, `bevelSegments` | the rounded edge on cylinders, cones and boxes; spheres, tori and tubes have none |
| `segments` | around a cylinder, cone or torus; 32 is smooth, 10 is a facet look |
| `sphere` | [u, v] of a sphere; [24, 12] smooth, [10, 6] faceted |
| `smooth`, `smoothAngle` | smooth shading with sharp edges above the angle, or flat |
| `minThickness` | for the modeller: thinner parts vanish at the far view |
| `materialsPerItem` | the check warns above it |

## Cost

Per part, before bevel: a cylinder is `2 × segments` side triangles plus
two caps; a sphere `2 × u × (v − 1)`; a torus `2 × segments × minor`; a
tube `2 × segments × (points − 1)`. The bevel adds two faces per bevel
segment per edge. With 32 segments and a 2-segment bevel a two-part hat
lands around 3500 triangles; a 20 × 10 sphere is 360.
