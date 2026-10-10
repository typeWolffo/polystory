# What makes a model read

These hold in every direction; the project's `style.md` says how they
apply there, with its numbers.

## Silhouette

- One dominant mass and one accent. A hat is a crown and a brim, plus at
  most a band; a prop is the thing and its handle; a pickup is one shape
  and one mark.
- Readable where the game looks at it: a portrait crop at thirty pixels,
  a prop seven metres from the camera, an icon on a shelf. Fine lines
  vanish; thin parts are at least the style's `minThickness`.
- Exaggerate. A realistic fit looks timid on a stylised body; the first
  set of a good style is usually a fifth larger than life.
- Nothing passes through what it mounts on: not the head, not the eyes,
  not the hand. The preview's `close` and `figure` views show it.

## Surface

- The style's bevel on every hard edge, the same width everywhere; a
  part that needs a different bevel is a different part.
- No textures, no vertex colours, no transparency: colour is one palette
  material per part. A new colour is a decision for the user, never a
  recipe's.
- Two materials per item is the norm, the style's `materialsPerItem` the
  ceiling. A glowing part is one material with `emissive`; the engine adds
  its own intensity on top.

## Budget

- Under the target, always under the cap. The default knobs spend
  triangles on segments and bevels; when a part is small on screen, give
  it fewer segments rather than removing the bevel.
- One file per model, no empties, no animation, no skin unless the kind
  has a skinned budget.

## The loop

1. Recipe from the brief and the reference.
2. Build; read the numbers and the check.
3. Preview; look at every render before judging. A render that was not
   opened was not looked at.
4. Fix the recipe, not the file.
5. Send the renders; the user decides.

## Why it is shaped like this

A first batch of twenty-five accessories for one game came out as raw
primitives and had to be rebuilt in the first set's language; one hat was
fixed twice and another thrown away. A written style did not prevent it.
A generator that bevels and smooths every part the same way, a check that
reads the bytes, and a render that has to be looked at before "done" are
the three things that did.
