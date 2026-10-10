// Says whether a build can run here: Blender, node, the profile, the style,
// the folders and the rig. Exit 1 on a FAIL.
//
//   node doctor.mjs [--project <root>]
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { blenderVersion, findBlender, findProject, loadProfile, loadStyle, PROFILE_DIR, projectPath, STYLE_DOC } from "./lib/profile.mjs";

export function diagnose(root) {
  const rows = [];
  const add = (status, what, detail = "") => rows.push({ status, what, detail });
  const nodeMajor = +process.versions.node.split(".")[0];
  add(nodeMajor >= 20 ? "OK" : "FAIL", `node ${process.versions.node}`, nodeMajor >= 20 ? "" : "node 20 or newer is needed");

  const profile = root ? loadProfile(root) : null;
  const blender = findBlender(profile?.profile ?? null);

  if (!blender) {
    add("FAIL", "blender", "not found on PATH, in the usual place, POLYSTORY_BLENDER or profile.blender");
  } else {
    const v = blenderVersion(blender);
    const okVersion = v && (v.major > 4 || (v.major === 4 && v.minor >= 2));
    add(okVersion ? "OK" : "FAIL", `blender ${v?.text ?? "?"}`, okVersion ? blender : `${blender}: 4.2 or newer is needed`);
  }

  if (!root) {
    add("FAIL", "profile", "no .polystory/profile.json above the working directory: run /polystory:init");

    return rows;
  }

  add(profile.problems.length ? "FAIL" : "OK", "profile", profile.problems.join("; "));

  for (const [name, kind] of Object.entries(profile.profile.kinds ?? {})) {
    for (const dir of ["models", "recipes"]) {
      if (typeof kind[dir] === "string") add(existsSync(projectPath(root, kind[dir])) ? "OK" : "FAIL", `${name}.${dir}`, kind[dir]);
    }

    if (kind.rig?.blend) add(existsSync(projectPath(root, kind.rig.blend)) ? "OK" : "FAIL", `${name}.rig.blend`, kind.rig.blend);

    if (kind.rig?.glb) add(existsSync(projectPath(root, kind.rig.glb)) ? "OK" : "WARN", `${name}.rig.glb`, kind.rig.glb || "skinned files cannot be checked against the rig");

    if (kind.slots) {
      for (const [slot, spec] of Object.entries(kind.slots)) {
        const folder = join(projectPath(root, kind.models), spec.folder);
        add(existsSync(folder) ? "OK" : "WARN", `${name}.slots.${slot}`, existsSync(folder) ? `${spec.folder}/` : `${spec.folder}/ does not exist yet`);
      }
    }

    if (!kind.register?.command && !kind.register?.doc) add("WARN", `${name}.register`, "no command or doc: the skill will not know how the project registers a new file");
  }

  const style = loadStyle(root);
  add(style.style ? (style.problems.length ? "FAIL" : "OK") : "FAIL", "style", style.style ? style.problems.join("; ") : "no .polystory/style.json: run /polystory:style");
  add(existsSync(join(root, PROFILE_DIR, STYLE_DOC)) ? "OK" : "WARN", "style.md", existsSync(join(root, PROFILE_DIR, STYLE_DOC)) ? "" : "the written look is missing; the build works, the recipes will drift");

  return rows;
}

export function runDoctor(argv) {
  let projectArg = null;

  for (let i = 0; i < argv.length; i++) if (argv[i] === "--project") projectArg = argv[++i];

  const root = projectArg ? resolve(projectArg) : findProject();
  const rows = diagnose(root);

  for (const r of rows) console.log(`${r.status.padEnd(4)} ${r.what}${r.detail ? `  ${r.detail}` : ""}`);

  const failed = rows.some((r) => r.status === "FAIL");
  console.log(failed ? "\nnot ready" : "\nready");

  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exit(runDoctor(process.argv.slice(2)));
}
