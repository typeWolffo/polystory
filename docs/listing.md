# Listing copy

The same words everywhere a person or a crawler meets polystory, so a
search for any of them lands here.

## GitHub

- **Description**: Model 3D game assets as code: a Python recipe per model, built headless in Blender into a GLB, checked and rendered before it ships. Claude Code plugin + Agent Skill + CLI.
- **Topics**: `3d`, `3d-modeling`, `blender`, `gltf`, `glb`, `low-poly`, `game-assets`, `gamedev`, `procedural-modeling`, `threejs`, `react-three-fiber`, `claude-code`, `claude-code-plugin`, `agent-skills`, `ai-agents`, `codex`, `cursor`
- **Website**: the npm page until there is a site.

```
gh repo create typeWolffo/polystory --public --source . --push \
  --description "Model 3D game assets as code: a Python recipe per model, built headless in Blender into a GLB, checked and rendered before it ships. Claude Code plugin + Agent Skill + CLI."
gh repo edit typeWolffo/polystory --add-topic 3d --add-topic 3d-modeling --add-topic blender --add-topic gltf --add-topic glb --add-topic low-poly --add-topic game-assets --add-topic gamedev --add-topic procedural-modeling --add-topic threejs --add-topic react-three-fiber --add-topic claude-code --add-topic claude-code-plugin --add-topic agent-skills --add-topic ai-agents --add-topic codex --add-topic cursor
```

A social preview image: `docs/calibration-toy.jpg` (Settings → Social preview).

## npm

`package.json` carries the description and keywords; the README is the
package page. `npm publish --access public` after `npm login`.

## Anthropic's plugin directory

Submitted from https://claude.ai/directory/manage (Pro or Max). The
portal validates the manifest and scans the repo; the listing appears in
`/plugin` → Discover and on claude.com/plugins.

- **Name**: polystory
- **Tagline** (one line): Model 3D game assets as code with Blender: recipes, headless builds, GLB checks and renders, in your project's own style.
- **Description**:

  polystory turns 3D asset work into code an agent can do well. One short
  Python recipe per model; `polystory build` runs it in headless Blender
  and exports a GLB; the check reads the bytes against your project's
  triangle and byte budgets, size envelopes and palette; `polystory
  preview` renders it on your rig or a turntable so the agent, and you,
  look before it ships. `init` captures the facts of your project by
  scanning its GLBs and asking only what it cannot see. `style` writes
  the look down, derived from your existing files or chosen from four
  rendered directions (toy, faceted, clay, hard-surface). Everything
  project-specific lives in one committed folder, `.polystory/`. For
  low-poly, flat-coloured, stylised props, pickups, hats, projectiles and
  set pieces in three.js, Babylon, Godot, Unity or Unreal. Needs Blender
  4.2+ and node 20+.

- **Category**: Design / Creative tools (or Developer tools)
- **Components**: one skill (`polystory`), one PostToolUse hook (Claude Code only).

## skills.sh and the skills CLI

Nothing to submit: `npx skills add typeWolffo/polystory` works as soon as
the repo is public, and the directory ranks by installs. The skill's
`name` and `description` frontmatter are what `npx skills find` matches.

## Other directories that index public plugins

- claude-plugins.dev indexes public GitHub repos with `.claude-plugin/`
  automatically.
- Awesome lists (`awesome-claude-code`, `awesome-agent-skills`): a pull
  request with the one-line description above.
