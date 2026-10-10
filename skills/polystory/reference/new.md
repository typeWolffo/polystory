# polystory new

A model is a recipe: a Python file with an `ITEM` dict and a `build(kit)`
function, built by `blender -b` into a GLB, so the same recipe gives the
same geometry on any machine. Nothing is modelled by hand. The kit, the
ITEM contract and the knobs are in `polystory guide recipe`;
the rules that make a model read well in `polystory guide craft`.
Read both once per session, then the project's `.polystory/style.md`
before every recipe.

## 1. Context

`polystory context`. It prints
the kinds with their folders, units, slots and sockets, budgets, the
register command, and the style's knobs. If it lists `missing`, stop and
run the skill it names (`polystory init`, `polystory style`).

## 2. Brief

From `$ARGUMENTS`: the kind, the id, for a slotted kind the slot, and the
description. Resolve:

- `model`: the file key. Slotted kind: `<slot folder>/<name>`; flat kind:
  `<name>`. Dashes in the name, no extension.
- Every placeholder of the register command (`{pl}`, `{en}`, …) is an ITEM
  field; ask for the values if the brief does not give them.
- The reference: the existing model of the same slot or kind the new one
  should sit next to, from `style.md`'s per-kind section. The preview can
  show an object from the rig file beside the new one (`--ref <object>`).

If the kind has a `skinnedBudget` and the brief is a garment (sleeves,
trousers, a scarf), stop: a skinned mesh is not built by a recipe; say
where the project builds those (the profile's `description`).

## 3. Recipe

Write `<recipes>/<model>.py` from `polystory guide slotted`
or `polystory guide flat`. The kit has `cylinder`, `cone`, `sphere`, `box`, `torus`,
`tube`; every call takes a palette material from `style.json` and lands in
the item's own space. Bevel, segments and shading come from the style's
knobs; override per call only with a reason you can say out loud. One
dominant mass, one accent; sizes from `style.md`'s envelopes, not from
guesswork.

## 4. Build

`polystory build <recipe.py>`

The output lands at `<models>/<model>.glb`, the recipe's path mirrored. The
command prints `BUILT {...}` (triangles, bounds, materials) and then the
check's verdict on the file. `FAIL` never ships. A `WARN` needs a reason
(a balloon sticks out of the hand envelope: fine; twice the triangle
target for a hat: not fine).

## 5. Preview, then look

`polystory preview <glb> [--ref <rig object>]`

Three PNGs in `.polystory/previews/<model>/`: `close` (the item fills the
frame), `figure` (on the rig, or on the turntable floor) and `far` (from
the game's viewing distance). With `--ref`, the same three of the
reference. Open every one with the Read tool and judge against
`craft.md`: does it sit where it should, does it clip anything, is the
bevel visible up close, does the shape survive the far view, is it as
chunky as the reference. Fix the recipe and go back to step 4 until it
does. Then send the renders to the user with SendUserFile; the user
decides, not the script.

## 6. Register

`polystory register <recipe.py>`
runs the kind's command with the ITEM fields filled in, or prints the
paragraph to follow by hand. Then whatever the profile's register doc
says to run (tests, formatters).

## 7. Hand over

The recipe, the GLB, the renders, the registration diff. No commit: the
user commits, every time.

## What the scripts refuse

- A material outside `style.json`: the build raises before exporting.
- A kind or slot the profile does not know, a model key in the wrong
  folder: the build stops before Blender starts working.
- A GLB with a texture, an animation, a root node off the origin, a colour
  that is not the palette's, a skin on a kind that has no skinned budget,
  more triangles or bytes than the cap: the check fails.
- A register command whose placeholders the ITEM does not fill.
