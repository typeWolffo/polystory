# polystory doctor

Run `polystory doctor` and read every line.

- `FAIL node`: node 24 or newer is needed; the build runs TypeScript
  recipes directly.
- `FAIL profile`: the listed field is wrong; fix it by hand or run
  `polystory init` to update that part.
- `FAIL style`: `polystory style`.
- `FAIL <kind>.models|recipes|rig.glb`: the path does not exist; create
  the folder or correct the path.
- `WARN browser`: renders need Chrome, Edge or a Playwright Chromium
  (`npx playwright install chromium`); the build and the check work
  without one, the previews do not.
- `INFO blender`: optional. When installed, `polystory open` can show a
  model in Blender and `polystory export --fbx` can write FBX.
- Other `WARN` lines do not stop a build; say what each one costs.

Report the table, the fixes applied, and `ready` or `not ready`.
