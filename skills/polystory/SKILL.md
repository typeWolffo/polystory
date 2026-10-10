---
name: polystory
description: Model 3D game assets as code with three.js. One TypeScript recipe per model, built in node into a GLB, checked against the project's triangle and byte budgets, size envelopes and palette, rendered on the project's rig or a turntable for the agent, then reviewed by the user in a local page with pins and registered the way the project does. Subcommands - init (the facts: folders, units, budgets, rig, sockets, registration), style (the look: palette and bevel/shading knobs, derived from existing GLBs or chosen from four rendered directions), new (a model), doctor (can a build run here). Blender optional. Use for "zamodeluj", "model 3D", "nowy model / rekwizyt / czapka / pocisk", "new 3D asset / prop / hat / pickup / projectile", "GLB", "low poly", "set up 3D modelling for this project", "what should our models look like". Not for skinned garments or textured, sculpted or scanned meshes.
argument-hint: "init | style [derive|throw] | new <kind> <id> [description] | doctor"
allowed-tools: Bash(npx -y polystory *), Bash(npx polystory *), Bash(polystory *), Bash(command -v polystory), Read(${CLAUDE_SKILL_DIR}/**)
---

# polystory

A model is a recipe: a short TypeScript module exporting `ITEM` and
`build(kit)`. `polystory build` runs it with three.js in node, writes a
GLB, and checks the bytes against the project's profile (budgets,
envelopes, slots) and style (palette, knobs). `polystory preview` renders
it in a headless browser for a look; `polystory review` opens it in the
user's browser with pins for notes. Nothing is modelled by hand, so the
same recipe gives the same geometry on any machine, and the look is
written down once per project in `.polystory/` instead of carried in
anyone's head. Blender is optional: `polystory open` shows a model there
when it is installed, `export --fbx` writes FBX through it.

## The CLI

Every step below runs the `polystory` CLI from npm, whatever installed
the skill. Resolve it once per session: when `command -v polystory` prints
a path (a global install, or `npm link` in a checkout of polystory), use
`polystory <command>`; otherwise `npx -y polystory <command>`.

`polystory` alone prints the commands. Node 24+ is required, and Chrome,
Edge or a Playwright Chromium for renders; `polystory doctor` says what is
missing.

## Commands

| Subcommand | Does | Load with |
| --- | --- | --- |
| `init` | writes `.polystory/profile.json`: the facts, by scan and interview | `polystory guide init` |
| `style` | writes `.polystory/style.json` and `style.md`: the look, derived or chosen | `polystory guide style` |
| `new <kind> <id> [description]` | recipe → build → check → renders → register | `polystory guide new` |
| `doctor` | can a build run here, and what to fix | `polystory guide doctor` |

`polystory guide <name>` prints the reference to stdout, which needs no
file permission wherever the skill is installed; the same files are in
[reference/](reference/) for a human.

Routing:

- **An explicit subcommand**: load its reference and follow it.
- **No argument**: run `polystory context` and say what the project has
  (profile, style, kinds, counts) and which subcommand comes next. Do not
  start one.
- **A request to model something** with no subcommand: that is `new`. If
  `context` reports a missing profile or style, say so and run `init` or
  `style` first; `new` refuses to guess the look.

Shared references, loaded when the subcommand's reference says so:
`polystory guide profile` (the two schemas), `polystory guide recipe`
(ITEM and the kit), `polystory guide craft` (what makes a model read).
Templates: `polystory guide slotted`, `guide flat` (recipes),
`guide style.md`, `guide profile.json`.

## Rules that hold in every subcommand

- Look at every render with the Read tool before judging it; a render
  that was not opened was not looked at. Send the renders to the user
  before calling a model done; the user decides.
- A `FAIL` from the check never ships. A `WARN` needs a reason said out
  loud.
- A new colour is a decision for the user, never a recipe's.
- No commit. The user commits, every time.
