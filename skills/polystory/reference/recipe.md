# A recipe

One TypeScript (or JavaScript) module, `recipes/<model>.ts`, imported by
`polystory build`. It exports `ITEM` and `build(kit)`; nothing else is
read. Node 24 runs the types away, so no build step; `npm i -D polystory`
in the project gives the editor the `Kit` and `Item` types.

```ts
// A bucket hat. z = 0 is the hat line on the head, +Z up, -Y the face.
import type { Item, Kit } from "polystory";

export const ITEM: Item = {
  kind: "accessory",       // a kind from profile.json
  id: "hat_bucket",        // the mesh's name in the file, and the catalog id
  slot: "hat",             // a slotted kind only
  model: "hats/bucket",    // the file key: models/<model>.glb, recipes/<model>.ts
  pl: "Kapelusz rybacki",  // anything the register command's placeholders need
  en: "Bucket hat",
  smooth_angle: 45,        // optional, overrides the style's knob for this item
  // optional, where the preview and the review page show it, over the
  // kind's preview: a prop that lands on a character's head is seen there
  // preview: { mount: "beside", socket: "socket_hat", offset: [0, 0, 0] },
};

export function build(kit: Kit) {
  kit.cylinder({ r: 0.74, h: 0.05, z: -0.03, mat: "acc_teal" });
  kit.cone({ r1: 0.55, r2: 0.5, h: 0.32, z: 0.1, mat: "acc_teal" });
  kit.sphere({ r: 0.5, z: 0.42, mat: "acc_teal", scale: [1, 1, 0.22] });
  kit.torus({ R: 0.56, r: 0.025, z: 0.1, mat: "acc_cream", minor: 8 });
}
```

## Frame

+Z up, -Y forward (the face, the direction a prop is thrown), +X the
subject's left. The export turns +Z into glTF's +Y. Units are the kind's:
metres, or a rig's units. The origin is what the code attaches: the socket
for a slotted item (model straight, the socket does the leaning), the
pivot for a prop (the centre of a ball, the point of impact of a splat,
the floor under a standing piece).

## The kit

Every call takes one object. `mat` is a material name from `style.json`
(default `base`); `x`, `y`, `z` place the shape; `rot` is `[rx, ry, rz]`
in degrees, applied Z then Y then X around the shape's own origin before
it moves; `warp` bends it before that (below). `bevel`, `bevel_segments`,
`segments`, `u`, `v` default to the style's knobs; pass a number to
override one call.

| Call | Shape |
| --- | --- |
| `cylinder({ r, h, …, bevel, segments, bevel_segments })` | standing on z, its base; height h |
| `cone({ r1, r2, h, … })` | truncated cone standing on z; `r2: 0` for a point |
| `sphere({ r, …, u, v, scale })` | UV sphere centred on (x, y, z); `scale: [1, 1, 0.3]` is a disc |
| `box({ sx, sy, sz, …, bevel, bevel_segments })` | centred on (x, y, z) |
| `torus({ R, r, …, segments, minor })` | a ring, flat (axis +Z) before `rot` |
| `lathe({ profile, …, bevel, segments, bevel_segments })` | a shape turned around +Z from `[radius, height]` points listed bottom to top, closed on the axis for you; its origin, not its centre, goes to (x, y, z) and is what `rot` turns about: crystals, bottles, vases, pawns |
| `blob({ balls, mat, resolution, blend })` | metaballs: `balls` are `[x, y, z, r]`, each showing radius r on its own, melted into one smooth surface; `blend` 0.1 keeps lumps apart with a soft seam (a cloud), 0.3 is goo (default), 0.5 one mass; `resolution` is cells across the whole thing (default 24), and the triangles grow with its square: slime, clouds, jelly, food |
| `tube({ points, r, mat, segments, smooth })` | a capped tube along a polyline: straps, stems, wires, fuses; `smooth: true` bends through the points instead of kinking at them |
| `extrude({ outline, holes, depth, smooth, …, bevel, bevel_segments })` | a flat outline given thickness: `[x, z]` points as seen from the front (x right, z up), `depth` along y centred on the origin, `holes` drawn the same way; the bevel is cut inside the outline, so the outline stays the silhouette; `smooth` runs a closed curve through the points: stars, hearts, arrows, blades, leaves, signs, gears |
| `loft({ sections, mat, segments, smooth, caps })` | a skin through cross-sections along a spine; a section is `{ at: [x, y, z] }` with `r` (a circle), `size: [w, h]` (an ellipse) or `shape: [[u, v], …]` (any outline), and `turn` in degrees; u points to the right of the spine and v up; `smooth` curves through the sections: bodies, fish, boats, shoes, grips |
| `hull({ points, mat })` | the convex hull of the points: rocks, gems, chunky crystals |
| `mesh({ geometry, … })` | any three.js `BufferGeometry` in recipe space; `kit.three` is the three.js namespace and `kit.addons` holds `ConvexGeometry` and `ParametricGeometry`, so a recipe never imports three; three's own shapes stand on y, so `rot: [90, 0, 0]` stands them on z |
| `cut({ from, away })` | `from` minus `away`, each a function that builds shapes with the kit it is given; the faces the cut opens wear `away`'s materials: holes, notches, a slot, a bite |
| `intersect({ a, b })` | only what `a` and `b` share |

A bevel is a circular fillet of the given width on every hard edge of a
cylinder, cone, lathe, box or extrude, cut after the shape has its size,
so it is the same width on every side. Spheres, tori, tubes, lofts and
hulls have none.

### Warps

`warp` takes one warp or a list, applied in order to the shape in its own
frame, along its own height z, before `x, y, z` and `rot` place it; a
tube, blob, loft or hull has no frame of its own and is warped where it
stands. A warp first splits the shape until no edge is longer than its
`detail` (default: an eighth of the shape), so a bend has vertices to
bend; that costs triangles.

| Warp | Does |
| --- | --- |
| `kit.bend({ angle, toward })` | curls the shape's height into an arc of `angle` degrees toward `x` (default), `-x`, `y` or `-y`: horns, tails, a hook, a bent nail |
| `kit.twist({ angle })` | turns the top `angle` degrees against the bottom: candy, drills, rope |
| `kit.taper({ top, bottom })` | scales x and y from `bottom` (1) at the base to `top` at the tip; adds no vertices |
| `kit.noise({ amount, size, seed })` | moves each vertex by smooth noise of up to `amount`, with features `size` across: a hand-made wobble, rock, dough |
| `{ fn: (p, t, box) => [x, y, z], detail }` | your own: `p` the point, `t` 0..1 up the shape, `box` its `{ min, max }` |

## Parts, markers and clips

Everything goes into the item's own mesh unless it is built inside a part:

```ts
kit.part({ name: "lid", pivot: [0, 0.16, 0.24] }, (k) => {
  k.box({ sx: 0.52, sy: 0.34, sz: 0.08, z: 0.28 });
});
kit.marker({ name: "loot", z: 0.3 });
kit.clip({ name: "open", duration: 0.6 }, { lid: { rot: [[0, [0, 0, 0]], [0.6, [-105, 0, 0]]], ease: "smooth" } });
kit.clip({ name: "fly", duration: 0.8 }, { wing_l: { rot: (t) => [0, 35 * Math.sin((2 * Math.PI * t) / 0.8), 0] } });
```

A part becomes its own node and mesh in the file, named `name`. Model it
where it rests, in the same coordinates as everything else; `pivot` is
only the point it turns about: a hinge, a shoulder, an axle. A part built
inside a part hangs from it, so a wing is an upper part at the shoulder
with a lower part at the elbow inside it. A marker is an empty node the
code finds by name: where loot appears, a muzzle, a grip, an exhaust.
Names are unique in the file; the item's id names its root.

A clip moves parts, and the root, by name. A track takes `rot` (degrees
around the pivot, in `rot`'s order, away from the rest pose), `pos`
(metres from where the part rests) and `scale` (a factor or `[x, y, z]`),
each as keys `[seconds, value]` or as a function of the time, sampled at
the clip's `fps` (30). `ease` is `linear` (the default), `smooth` (eased
in and out between keys) or `step`. Rotations are always sampled, so a
key 360° away spins a full turn. A loop ends on its first pose. There is
no skinning: what bends is parts on joints.

`build(kit)` returns nothing. The item and each part become one mesh with
one primitive per material, every face smooth with edges sharper than the
smooth angle split (or every face flat when the style says so), vertices
shared, and are written as a GLB: positions, normals, indices, the parts
as nodes at their pivots, markers as empty nodes, clips as animations; no
texcoords, no skin, Y-up.

## Knobs, and what they do

| Knob | Effect |
| --- | --- |
| `bevel`, `bevelSegments` | the rounded edge on cylinders, cones and boxes; 0 for none |
| `segments` | around a cylinder, cone or torus; 32 is smooth, 10 is a facet look |
| `sphere` | [u, v] of a sphere; [24, 12] smooth, [10, 6] faceted |
| `smooth`, `smoothAngle` | smooth shading with sharp edges above the angle, or flat |
| `minThickness` | for the modeller: thinner parts vanish at the far view |
| `materialsPerItem` | the check warns above it |

## Cost

Per part: a cylinder is `2 × segments` side triangles plus two cap fans
of `segments` each, and each bevel segment adds a ring of `2 × segments`;
a sphere `2 × u × (v − 1)`; a blob about `2 × surface / cell²`, so a 0.5 m cloud at resolution 22 is ~2400; a torus `2 × segments × minor`; a tube
`2 × segments × (points − 1)` plus two caps; a loft the same per section
(times the `smooth` steps); an extrude about `4 × outline points ×
(1 + bevel_segments)` plus two caps. A cut adds triangles where it cuts
and splits the faces around it; a warp multiplies a shape by roughly
`(size / detail)²`. With 32 segments and a 2-segment bevel a two-part hat
lands around 3000 triangles; a 20 × 10 sphere is 360. A build takes
milliseconds, so try and look.
