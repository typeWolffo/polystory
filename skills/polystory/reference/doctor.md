# polystory doctor

Run `polystory doctor` and read
every line.

- `FAIL blender`: install Blender 4.2 or newer, or point at it with
  `POLYSTORY_BLENDER=/path/to/blender` or `"blender": "/path"` in
  `.polystory/profile.json`.
- `FAIL profile`: the listed field is wrong; fix it by hand or run
  `polystory init` to update that part.
- `FAIL style`: `polystory style`.
- `FAIL <kind>.models|recipes|rig.blend`: the path does not exist; create
  the folder or correct the path. A rig outside the repo is given with
  `~/`.
- `WARN` lines do not stop a build; say what each one costs.

Report the table, the fixes applied, and `ready` or `not ready`.
