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
(default `base`); `x`, `y`, `z` place the part; `rot` is `[rx, ry, rz]`
in degrees, applied Z then Y then X around the part's own origin before
it moves. `bevel`, `bevel_segments`, `segments`, `u`, `v` default to the
style's knobs; pass a number to override one call.

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

A bevel is a circular fillet of the given width on every hard edge of a
cylinder, cone, lathe or box, cut after the part has its size, so it is the
same width on every side. Spheres, tori and tubes have none.

`build(kit)` returns nothing; the parts are joined into one mesh named
`ITEM.id` with one primitive per material, every face smooth with edges
sharper than the smooth angle split (or every face flat when the style
says so), vertices shared, then written as a GLB: positions, normals,
indices, no texcoords, no skin, no animation, Y-up.

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
`2 × segments × (points − 1)` plus two caps. With 32 segments and a
2-segment bevel a two-part hat lands around 3000 triangles; a 20 × 10
sphere is 360. A build takes milliseconds, so try and look.
