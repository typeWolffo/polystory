# polystory init

`init` writes `.polystory/profile.json`: the durable facts about where
models live and how the project uses them. It does not decide the look;
`polystory style` does that afterwards, from the files or from a choice.
The schema is in `polystory guide profile`; read it
before writing.

## 1. Current state

Run `polystory context` once.

- **No profile**: explore, interview, write.
- **A profile exists**: ask what is stale or missing and update that; never
  overwrite a working profile with a fresh one.
- **Problems listed**: fix those fields and stop there unless asked for more.

## 2. Explore before asking

Scan enough that the user never repeats what the repo already says:

- Folders with GLBs: `polystory scan --dirs <a,b,…>`
  on every folder outside `node_modules` that holds `.glb` files (find them
  with Glob). The summary gives per folder: counts, triangle percentiles,
  extents in file units, whether files are skinned or animated, the colours.
  A file with skins and empties named like `socket_*` is a rig; the scan
  prints the empties with their world positions (glTF is Y-up: the file's y
  is height).
- The engine: `three` / `@react-three/fiber` / `babylonjs` in a
  `package.json`, `ProjectSettings/` (Unity), `project.godot`, `.uproject`.
  Only for the write-up; the build is the same.
- How a model reaches the game today: a catalog file, a `?url` import, a
  resource path. That becomes `register`.

Treat what you find as a hypothesis the user confirms, not as a fact.

## 3. Interview

Use AskUserQuestion. At most three questions per round, at most three
rounds, only about gaps the repo does not answer. Confirm inferences in
the same question ("the hats folder holds items for `socket_hat`, correct?").
Ask, in this order, as needed:

1. **Kinds.** Which folders are which kind of model, and what each kind is
   for in one line. One kind per folder. A folder with sub-folders per
   mounting point (hats/, face/, hand/) is one kind with slots.
2. **Units.** Metres, or a rig's units (give the rig height in units and in
   metres; `unitsPerMetre` is their ratio).
3. **Rig and sockets.** The rig GLB the game loads, with its sockets as
   named nodes (the scan lists them), the socket per slot. Without a
   rig, previews are a turntable.
4. **Budgets.** Propose from the scan: target = the p90 of the existing
   files rounded up, cap = 1.5× that, bytes = the max rounded up. The user
   corrects.
5. **Registration.** A shell command with `{id}`, `{slot}`, `{model}`,
   `{file}` and any other ITEM field as placeholders, or a paragraph for a
   human to follow. Both may be empty when the game loads files by name.

Do not ask about colours, bevels, style or references: that is `style`.

## 4. Write

- `.polystory/profile.json` per the reference. `~/` is allowed in paths
  outside the project; everything else is relative to the project root.
- Create each kind's `recipes` folder when it does not exist, with a
  one-paragraph README: one TypeScript file per model, `recipes/<model>.ts`
  builds `models/<model>.glb`, built by `polystory new`.
- Add `.polystory/.glb-check-stamp`, `.polystory/scan.json`,
  `.polystory/previews/`, `.polystory/review/` and `.polystory/calibration/`
  to `.gitignore`.

## 5. Verify and hand over

`polystory doctor` must say
`ready` except for the missing style. Report the profile in five lines
(kinds, units, rig, budgets, registration) and point at `polystory style`
as the next step. No commit.
