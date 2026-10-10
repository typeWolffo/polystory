# The look

<One paragraph: what every model in this project looks like, in words a
modeller would use. Name the direction (toy, faceted, clay, hard-surface,
or your own) and the two or three things that make it recognisable.>

## Units and axes

- <Which units each kind is modelled in, what one unit is in metres, and
  what z = 0 means for each slot (the hat line, the floor, the pivot).>
- +Z up, -Y forward in every recipe; the export turns +Z into glTF's +Y.

## Surfaces

- Bevel <width> with <n> segments on every hard edge; scale is baked into
  the primitive before the bevel, so the bevel is the same width on every
  side.
- <Smooth with sharp edges over N°, or flat shaded.>
- No textures, no vertex colours, no transparency. One palette material per
  part; a new colour is a decision for the user, not a recipe.

## Palette, by role

| Material | Use |
| --- | --- |
| `base` | <the dominant mass> |
| `accent` | <the one bright detail> |
| `dark` | <outlines, handles, frames> |
| `light` | <white parts> |
| `glow` | <anything that emits light> |

<N> materials per item is the norm, <M> the ceiling.

## Silhouette

- One dominant mass and one accent. <What that means for the kinds here.>
- Readable at <N> px / from <N> m: fine lines vanish, thin parts are at
  least <minThickness> thick.
- <Exaggeration rule, if any: "a fifth larger than a realistic fit".>

## Per kind

### <kind>

- <The reference objects a new one should sit next to.>
- <Envelopes in words, where the budgets come from, what the preview
  shows.>
