// Says whether a build can run here: node, a browser for renders, the
// profile, the style, the folders and the rig; Blender as an optional
// extra. Exit 1 on a FAIL.
//
//   polystory doctor [--project <root>]
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { blenderVersion, findBlender, findProject, loadProfile, loadStyle, PROFILE_DIR, projectPath, STYLE_DOC } from "./lib/profile.ts";
import { findBrowser } from "./render.ts";

export type Row = { status: "OK" | "WARN" | "FAIL" | "INFO"; what: string; detail: string };

export function diagnose(root: string | null): Row[] {
  const rows: Row[] = [];
  const add = (status: Row["status"], what: string, detail = "") => rows.push({ status, what, detail });
  const nodeMajor = +process.versions.node.split(".")[0];
  add(nodeMajor >= 24 ? "OK" : "FAIL", `node ${process.versions.node}`, nodeMajor >= 24 ? "" : "node 24 or newer is needed (recipes are TypeScript, run directly)");
  const browser = findBrowser();
  add(browser ? "OK" : "WARN", "browser for renders", browser ?? "none: install Google Chrome, or run `npx playwright install chromium`; build and check work without one");

  const profile = root ? loadProfile(root) : null;
  const blender = findBlender(profile?.profile ?? null);
  add("INFO", "blender", blender ? `${blenderVersion(blender)?.text ?? "?"} at ${blender} (optional: open, export --fbx)` : "not installed (optional: open, export --fbx)");

  if (!root || !profile) {
    add("FAIL", "profile", "no .polystory/profile.json above the working directory: run polystory init");

    return rows;
  }

  add(profile.problems.length ? "FAIL" : "OK", "profile", profile.problems.join("; "));

  for (const [name, kind] of Object.entries(profile.profile.kinds ?? {})) {
    for (const dir of ["models", "recipes"] as const) {
      if (typeof kind[dir] === "string") add(existsSync(projectPath(root, kind[dir])) ? "OK" : "FAIL", `${name}.${dir}`, kind[dir]);
    }

    if (kind.rig?.glb) add(existsSync(projectPath(root, kind.rig.glb)) ? "OK" : "FAIL", `${name}.rig.glb`, kind.rig.glb);

    for (const [slot, spec] of Object.entries(kind.slots ?? {})) {
      const folder = join(projectPath(root, kind.models), spec.folder);
      add(existsSync(folder) ? "OK" : "WARN", `${name}.slots.${slot}`, existsSync(folder) ? `${spec.folder}/` : `${spec.folder}/ does not exist yet`);
    }

    if (!kind.register?.command && !kind.register?.doc) add("WARN", `${name}.register`, "no command or doc: the skill will not know how the project registers a new file");
  }

  const style = loadStyle(root);
  add(style.style ? (style.problems.length ? "FAIL" : "OK") : "FAIL", "style", style.style ? style.problems.join("; ") : "no .polystory/style.json: run polystory style");
  const doc = existsSync(join(root, PROFILE_DIR, STYLE_DOC));
  add(doc ? "OK" : "WARN", "style.md", doc ? "" : "the written look is missing; the build works, the recipes will drift");

  return rows;
}

export function runDoctor(argv: string[]): number {
  let projectArg: string | null = null;

  for (let i = 0; i < argv.length; i++) if (argv[i] === "--project") projectArg = argv[++i];

  const rows = diagnose(projectArg ? resolve(projectArg) : findProject());

  for (const r of rows) console.log(`${r.status.padEnd(4)} ${r.what}${r.detail ? `  ${r.detail}` : ""}`);

  const failed = rows.some((r) => r.status === "FAIL");
  console.log(failed ? "\nnot ready" : "\nready");

  return failed ? 1 : 0;
}
