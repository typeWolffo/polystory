# polystory style

The style is two files: `style.json`, what the build reads (knobs and the
palette), and `style.md`, what the modeller reads (the look in words, the
numbers in prose). The schema is in `polystory guide profile`
under "style.json"; the vocabulary of the knobs is in
`polystory guide recipe`.

Run `polystory context` first. No
profile means `polystory init` first. A style that exists is refined, not
replaced, unless the user asks for a new look.

## Which mode

- **Derive** when any kind has three or more models that are not ignored:
  the files are the canon, the user already chose by making them.
- **Throw** when there is nothing to scan, or the user says the existing
  files are not the look they want.

## Derive

1. `polystory scan` and read
   `.polystory/scan.json`. Per kind the summary says:
   - `shading`: `smooth` files have `vertsPerTri` under 1, `flat` over 1.5.
     Smooth wins when most files are smooth; then `smoothAngle` is 45 unless
     the hard-edge share (`edges.hard` + `edges.sharp`) is under 0.05, in
     which case 60.
   - `bevelled`: files where soft and rounded edges outweigh sharp ones.
     Bevelled means `bevel` > 0; the width is not measurable from the file,
     take 0.02 in the kind's units and let the calibration render decide.
   - `edges.soft` high with few `hard`: many segments (32). `rounded` high
     with `hard` high: few segments (10–16) or faceted.
   - `colours`: every base colour with how many files use it, the material
     names the files already carry, roughness, and whether it glows.
   - `tris.p90`, `bytes.max`: the budgets, already in the profile.
2. Name the palette. Existing material names are kept as they are; a colour
   with no name gets one by role (`ink`, `cream`, `accent_teal`). Present the
   table to the user: hex, count, proposed name, role in a few words. One
   round of corrections. Colours used by one file only are candidates to
   drop; ask.
3. Write `style.json`: `direction` (your one-word name for the look),
   `knobs`, `materials` with `role` lines, `perKind` overrides where a kind
   clearly differs (a prop kind that allows four materials), and
   `calibration`: which five materials play `base`, `accent`, `dark`,
   `light`, `glow` in the calibration set.
4. `polystory calibrate style`
   renders the calibration set under the written knobs. Look at
   `.polystory/calibration/style/style_front.png` with the Read tool next to
   a preview of an existing file (`polystory preview <one of the models>`)
   and compare: same bevel width, same softness, same colours. Adjust the
   knobs until they match; this is the only check that the numbers say what
   the files say.

## Throw

1. `polystory calibrate all`
   renders the set under `toy`, `faceted`, `clay` and `hard-surface`
   (`polystory guide directions.json`). Open every
   `*_front.png` with the Read tool, then send them to the user with
   SendUserFile and ask with AskUserQuestion which direction, offering the
   four with their one-line summaries. "Other" is allowed: then the user
   describes the look and you build it as a fifth entry by editing the
   knobs between renders, at most three rounds.
2. Brand colours: if the user gives hexes or a design system, replace the
   direction's palette with them, keep the five roles. Otherwise keep the
   direction's palette and say so.
3. Write `style.json` from the chosen direction and
   `calibrate style` once more as the canon render.

## style.md

Fill `polystory guide style.md`: the look in a paragraph
a modeller would recognise, units and what z = 0 means per slot, the
surface rules with the real numbers, the palette table by role, the
silhouette rules (what "readable" means here: a portrait at 32 px, a prop
from 7 m), and a per-kind section naming the reference models a new one
sits next to. Short, general, no file inventories.

## Hand over

`doctor` says `ready`. Show the canon render, list the two files, and say
that `polystory new` <kind> <id>` can start. No commit.
