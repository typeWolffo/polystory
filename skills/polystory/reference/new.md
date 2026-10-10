# polystory new

A model is a recipe: a TypeScript module exporting `ITEM` and
`build(kit)`, built by three.js in node into a GLB, so the same recipe
gives the same geometry on any machine. Nothing is modelled by hand. The kit, the
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

Write `<recipes>/<model>.ts` from `polystory guide slotted`
or `polystory guide flat`. The kit has `cylinder`, `cone`, `sphere`, `box`, `torus`,
`tube`; every call takes a palette material from `style.json` and lands in
the item's own space. Bevel, segments and shading come from the style's
knobs; override per call only with a reason you can say out loud. One
dominant mass, one accent; sizes from `style.md`'s envelopes, not from
guesswork.

## 4. Build

`polystory build <recipe.ts>`

The output lands at `<models>/<model>.glb`, the recipe's path mirrored. The
command prints `BUILT {...}` (triangles, bounds, materials) and then the
check's verdict on the file. `FAIL` never ships. A `WARN` needs a reason
(a balloon sticks out of the hand envelope: fine; twice the triangle
target for a hat: not fine).

## 5. Preview, then look

`polystory preview <glb> [--ref <another model's glb>]`

PNGs in `.polystory/previews/<model>/`: with a rig, `close` (the item
fills the frame), `figure` (on the rig) and `far` (from the game's
viewing distance); without one, `front`, `quarter` and `top` on a
turntable floor of 10 cm cells, plus `scale` beside a 1.75 m figure when
the profile asks for it. With `--ref`, the same views of the reference
model mounted the same way.
Open every one with the Read tool and judge against `craft.md`: does it
sit where it should, does it clip anything, is the bevel visible up
close, does the shape survive the far view, is it as chunky as the
reference. Fix the recipe and go back to step 4 until it does. Then hand
the look to the user: `polystory review <glb>` opens the review page in
their browser and waits; they turn the model, drop pins with notes, and
accept or send changes. Run it again after every rebuild, for this model
or the next one: a tab that is already on the page is reused and brought
to the front (macOS and Linux, where the browser allows it), and it
reloads the model by itself, so the user keeps one tab for the whole
session. `--no-open` only when they asked not to be
interrupted. The command prints what came back and writes it
under `.polystory/review/<model>/`; each pin has a point, a normal, the
camera and a screenshot (`<n>-pin-<k>.jpg`, open them with the Read tool
to see what they saw). `changes` means back to step 3 with those notes;
`rejected` means the direction is wrong, ask before rebuilding;
`accepted` means step 6. Without a browser on their side (a remote
session), send the renders with SendUserFile instead and ask in chat.

### When the user prefers Blender

`polystory open <glb>` imports the file into Blender when Blender is
installed: into the running instance when an MCP add-on is connected
(tools named `mcp__blender__*` in the session), otherwise by starting
Blender with the file. In the MCP case you can do it yourself after the
renders, and look at their viewport:

1. With the MCP's code-execution tool, run in their Blender:

   ```python
   import bpy
   old = bpy.data.collections.get("polystory_preview")

   if old:
       for o in list(old.objects):
           bpy.data.objects.remove(o, do_unlink=True)

       bpy.data.collections.remove(old)

   col = bpy.data.collections.new("polystory_preview")
   bpy.context.scene.collection.children.link(col)
   bpy.ops.import_scene.gltf(filepath="<absolute path of the GLB>")

   for o in bpy.context.selected_objects:
       for c in o.users_collection:
           c.objects.unlink(o)

       col.objects.link(o)
   ```

   A rig-mounted item is in socket space: if the rig is open in that
   file, parent the imported object to the slot's socket with an identity
   `matrix_parent_inverse` so it sits where the game puts it; otherwise
   leave it at the origin and say so.
2. Frame it with the MCP's "jump to object" tool (or `view3d.view_selected`
   through the code tool), then take a viewport screenshot with the MCP's
   screenshot tool and look at it the way you looked at the renders.
3. Tell the user the model is in the `polystory_preview` collection of
   their open file, and ask them to turn it and say what is off.

Never save their file (`bpy.ops.wm.save_mainfile` is off limits), never
touch objects outside `polystory_preview`, and treat the MCP as a window:
the recipe is still the only thing you edit, and the headless renders
are still what ships in the hand-over.

## 6. Register

`polystory register <recipe.ts>`
runs the kind's command with the ITEM fields filled in, or prints the
paragraph to follow by hand. Then whatever the profile's register doc
says to run (tests, formatters).

## 7. Hand over

The recipe, the GLB, the renders, the registration diff. No commit: the
user commits, every time.

## What the scripts refuse

- A material outside `style.json`: the build raises before exporting.
- A kind or slot the profile does not know, a model key in the wrong
  folder: the build stops before any geometry is made.
- A GLB with a texture, an animation, a root node off the origin, a colour
  that is not the palette's, a skin on a kind that has no skinned budget,
  more triangles or bytes than the cap: the check fails.
- A register command whose placeholders the ITEM does not fill.
