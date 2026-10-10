---
name: polystory
description: Model 3D game assets as code with Blender. One Python recipe per model, built headless into a GLB, checked against the project's triangle and byte budgets, size envelopes and palette, rendered on the project's rig or a turntable for review, then registered the way the project does. Subcommands - init (the facts: folders, units, budgets, rig, sockets, registration), style (the look: palette and bevel/shading knobs, derived from existing GLBs or chosen from four rendered directions), new (a model), doctor (can a build run here). Use for "zamodeluj", "model 3D", "nowy model / rekwizyt / czapka / pocisk", "new 3D asset / prop / hat / pickup / projectile", "GLB", "low poly", "set up 3D modelling for this project", "what should our models look like". Not for skinned garments or textured, sculpted or scanned meshes.
argument-hint: "init | style [derive|throw] | new <kind> <id> [description] | doctor"
allowed-tools: Bash(npx -y polystory *), Bash(npx polystory *), Bash(polystory *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/polystory.mjs" *), Read(${CLAUDE_SKILL_DIR}/**)
---

# polystory

A model is a recipe: a short Python file with an `ITEM` dict and a
`build(kit)` function. `polystory build` runs it in `blender -b`, exports
a GLB, and checks the bytes against the project's profile (budgets,
envelopes, slots) and style (palette, knobs). `polystory preview` renders
it for a look. Nothing is modelled by hand, so the same recipe gives the
same geometry on any machine, and the look is written down once per
project in `.polystory/` instead of carried in anyone's head.

## The CLI

Every step below runs the `polystory` CLI. Resolve it once per session:

- In a Claude Code plugin install, `${CLAUDE_PLUGIN_ROOT}` is a real path:
  use `node "${CLAUDE_PLUGIN_ROOT}/scripts/polystory.mjs" <command>`.
- Otherwise (a skill copied into `.claude/skills/`, another agent, or the
  text above still reads `${CLAUDE_PLUGIN_ROOT}` literally): use
  `npx -y polystory <command>`, or `polystory <command>` when it is on PATH.

`polystory` alone prints the commands. Blender 4.2+ and node 20+ are
required; `polystory doctor` says what is missing.

## Commands

| `$ARGUMENTS[0]` | Does | Load with |
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
