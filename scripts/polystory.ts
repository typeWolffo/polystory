#!/usr/bin/env node
// The one entry point. Every skill calls this; it finds the project, the
// profile and the style, builds with three.js in node, renders in a
// headless browser, and hands Blender the optional jobs.
//
//   polystory context|doctor|scan|check|build|item|register|preview|review|calibrate|open|export|guide|install [args]
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { checkFile, runCheck } from "./check.ts";
import { gather, nextStep, runContext } from "./context.ts";
import { runDoctor } from "./doctor.ts";
import { buildToFile, knobsFor, loadRecipe } from "./kit/build.ts";
import type { Item, Style } from "./kit/types.ts";
import { blenderVersion, findBlender, findProject, kindOfFile, loadProfile, loadStyle, modelPathFor, PROFILE_DIR, projectPath, recipeFor, slotOfFile, type Kind, type Preview, type Profile } from "./lib/profile.ts";
import { renderViews } from "./render.ts";
import { runReview } from "./review.ts";
import { SKILL_DIR, TEMPLATES_DIR } from "./lib/paths.ts";
import { runScan } from "./scan.ts";
import type { ReviewPayload, StatusPayload, ViewerConfig } from "./server.ts";

const SKILL = SKILL_DIR;
const TEMPLATES = TEMPLATES_DIR;

const USAGE = `usage: polystory <command> [args]

  context                               the project's state, for a skill to read first
  doctor                                can a build run here
  scan [--dirs a,b] [--out file]        measure the GLBs into .polystory/scan.json
  check [--kind k] <glb…>               may these files ship
  build <recipe.ts> [--out <glb>]       recipe → GLB → check
  item <recipe.ts>                      print the recipe's ITEM as JSON
  register <recipe.ts>                  run the kind's register command for the recipe
  preview <glb> [--ref <glb>] [--out <dir>] [--kind k]
  review <glb> [--ref <glb>] [--port n] [--no-open] [--timeout min]   reuses the tab already open on the page
  calibrate [all|<direction>|style] [--out <dir>]
  open <glb>                            show the file in Blender (optional, when installed)
  export --fbx <glb> [--out <fbx>]      write FBX through Blender (optional, when installed)
  guide <name>                          print a reference or template of the skill
  install [-g] [--dir <path>]           copy the polystory skill into .claude/skills/ (project) or ~/.claude/skills/ (-g)
  blender                               print the Blender binary in use, if any

Every command takes --project <root>; otherwise the nearest .polystory/ above the working directory is used.`;

type Args = { positional: string[]; flags: Record<string, string | true> };

function parse(argv: string[], valued: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a.startsWith("--")) {
      const key = a.slice(2);
      flags[key] = valued.includes(key) ? (argv[++i] ?? "") : true;
    } else if (a === "-g") {
      flags.global = true;
    } else {
      positional.push(a);
    }
  }

  return { positional, flags };
}

function projectOf(flags: Args["flags"]): string | null {
  return typeof flags.project === "string" ? resolve(flags.project) : findProject();
}

function requireProject(root: string | null): { root: string; profile: Profile } {
  if (!root || !existsSync(join(root, PROFILE_DIR, "profile.json"))) {
    console.error("no .polystory/profile.json above the working directory: run polystory init, or pass --project");
    process.exit(2);
  }

  const { profile, problems } = loadProfile(root);

  if (problems.length) {
    console.error(`profile problems:\n  ${problems.join("\n  ")}`);
    process.exit(2);
  }

  return { root, profile };
}

function requireStyle(root: string): Style {
  const { style, problems } = loadStyle(root);

  if (!style || problems.length) {
    console.error(style ? `style problems:\n  ${problems.join("\n  ")}` : "no .polystory/style.json: run polystory style first");
    process.exit(2);
  }

  return style;
}

function kindOfItem(profile: Profile, item: Item): { name: string; kind: Kind } {
  const kind = profile.kinds[item.kind];

  if (!kind) {
    console.error(`ITEM.kind ${JSON.stringify(item.kind)} is not one of ${Object.keys(profile.kinds).join(", ")}`);
    process.exit(2);
  }

  if (kind.slots) {
    const slot = item.slot ? kind.slots[item.slot] : undefined;

    if (!slot) {
      console.error(`ITEM.slot ${JSON.stringify(item.slot)} is not one of ${Object.keys(kind.slots).join(", ")}`);
      process.exit(2);
    }

    if (!item.model.startsWith(`${slot.folder}/`)) {
      console.error(`ITEM.model ${JSON.stringify(item.model)} must start with "${slot.folder}/"`);
      process.exit(2);
    }
  } else if (item.model.includes("/")) {
    console.error(`ITEM.model ${JSON.stringify(item.model)} is a bare name for a ${item.kind}`);
    process.exit(2);
  }

  return { name: item.kind, kind };
}

// A recipe may say where it is worn (ITEM.preview), over the kind's
// default: a prop that lands on the head shows on the head, not in a hand.
async function itemPreview(root: string, kind: Kind, rel: string): Promise<Preview | undefined> {
  const recipe = recipeFor(root, kind, rel);

  if (!recipe) return undefined;

  return (await loadRecipe(recipe)).ITEM.preview as Preview | undefined;
}

function viewerConfig(root: string, kind: Kind, slotName: string | null, own?: Preview): { config: ViewerConfig; rigPath: string | undefined } {
  const preview: Preview = { ...kind.preview, ...own };
  const mount = preview.mount ?? "turntable";
  const socket = mount === "socket" ? (own?.socket ?? ((slotName && kind.slots?.[slotName]?.socket) || undefined)) : mount === "beside" ? preview.socket : undefined;

  if (mount === "socket" && !socket) {
    console.error(`no socket for slot ${JSON.stringify(slotName)}: the slot folder has no socket in the profile`);
    process.exit(2);
  }

  return {
    rigPath: mount !== "turntable" && kind.rig?.glb ? projectPath(root, kind.rig.glb) : undefined,
    config: {
      mount,
      unitsPerMetre: kind.unitsPerMetre,
      rigUnitsPerMetre: kind.rig?.unitsPerMetre ?? kind.unitsPerMetre,
      rigClip: kind.rig?.clip,
      rigClipAt: kind.rig?.clipAt,
      socket,
      offset: preview.offset ?? [-0.3, -0.2, 0.15],
      farMetres: preview.farMetres ?? 7,
      scaleFigure: preview.scaleFigure ?? false,
    },
  };
}

function nextReviewNumber(reviewDir: string): number {
  if (!existsSync(reviewDir)) return 1;

  const numbers = readdirSync(reviewDir).map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter((n): n is string => Boolean(n)).map(Number);

  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

function locate(root: string, profile: Profile, glb: string, kindFlag: string | undefined): { name: string; kind: Kind; slotName: string | null; rel: string } {
  const located = kindOfFile(root, profile, glb);
  const name = kindFlag ?? located?.name;
  const kind = name ? profile.kinds[name] : undefined;

  if (!name || !kind) {
    console.error(`${relative(root, glb)} is not inside a kind's models folder; pass --kind`);
    process.exit(2);
  }

  const rel = located?.name === name ? located.rel : glb;

  return { name, kind, slotName: located ? (slotOfFile(kind, located.rel)?.slot ?? null) : null, rel };
}

function blenderOrExit(profile: Profile | null): string {
  const blender = findBlender(profile);

  if (!blender) {
    console.error("Blender is not installed (it is optional): install it, or set POLYSTORY_BLENDER / profile.blender");
    process.exit(2);
  }

  return blender;
}

const commands: Record<string, (argv: string[]) => number | Promise<number>> = {
  context: runContext,
  doctor: runDoctor,
  scan: runScan,
  check: runCheck,

  blender: (argv) => {
    const { flags } = parse(argv, ["project"]);
    const root = projectOf(flags);
    const profile = root && existsSync(join(root, PROFILE_DIR, "profile.json")) ? loadProfile(root).profile : null;
    const blender = findBlender(profile);
    console.log(blender ? `${blender} (${blenderVersion(blender)?.text ?? "?"})` : "not installed (optional)");

    return blender ? 0 : 1;
  },

  item: async (argv) => {
    const { positional } = parse(argv, ["project"]);
    const recipe = resolve(positional[0] ?? "");

    if (!existsSync(recipe)) {
      console.error("usage: polystory item <recipe.ts>");

      return 2;
    }

    console.log(JSON.stringify((await loadRecipe(recipe)).ITEM, null, 2));

    return 0;
  },

  build: async (argv) => {
    const { positional, flags } = parse(argv, ["project", "out"]);
    const { root, profile } = requireProject(projectOf(flags));
    const style = requireStyle(root);
    const recipePath = resolve(positional[0] ?? "");

    if (!existsSync(recipePath)) {
      console.error("usage: polystory build <recipe.ts> [--out <file.glb>] [--no-check]");

      return 2;
    }

    const recipe = await loadRecipe(recipePath);
    const { name, kind } = kindOfItem(profile, recipe.ITEM);
    const target = typeof flags.out === "string" ? resolve(flags.out) : modelPathFor(root, kind, recipe.ITEM.model);
    const result = buildToFile(recipe, style, target, knobsFor(style, name));
    console.log(`BUILT ${JSON.stringify({ ...result, file: relative(root, target) })}`);

    return flags["no-check"] ? 0 : runCheck(["--project", root, "--kind", name, target]);
  },

  register: async (argv) => {
    const { positional, flags } = parse(argv, ["project"]);
    const { root, profile } = requireProject(projectOf(flags));
    const recipePath = resolve(positional[0] ?? "");

    if (!existsSync(recipePath)) {
      console.error("usage: polystory register <recipe.ts>");

      return 2;
    }

    const { ITEM: item } = await loadRecipe(recipePath);
    const { kind } = kindOfItem(profile, item);
    const target = modelPathFor(root, kind, item.model);

    if (!existsSync(target)) {
      console.error(`build first: ${relative(root, target)} does not exist`);

      return 2;
    }

    if (!kind.register?.command) {
      console.log(kind.register?.doc ?? `nothing to run: a ${item.kind} is registered by hand`);

      return 0;
    }

    const missing: string[] = [];
    const command = kind.register.command.replace(/\{(\w+)\}/g, (_, key: string) => {
      if (key === "file") return relative(root, target);

      if (item[key] === undefined) missing.push(key);

      return String(item[key] ?? "");
    });

    if (missing.length) {
      console.error(`the register command needs ITEM.${missing.join(", ITEM.")} and the recipe has none`);

      return 2;
    }

    console.log(`$ ${command}`);

    return spawnSync(command, { cwd: root, shell: true, stdio: "inherit" }).status ?? 1;
  },

  preview: async (argv) => {
    const { positional, flags } = parse(argv, ["project", "out", "ref", "kind"]);
    const { root, profile } = requireProject(projectOf(flags));
    const glb = resolve(positional[0] ?? "");

    if (!existsSync(glb)) {
      console.error("usage: polystory preview <file.glb> [--ref <other.glb>] [--out <dir>] [--kind k]");

      return 2;
    }

    const { kind, slotName, rel } = locate(root, profile, glb, typeof flags.kind === "string" ? flags.kind : undefined);
    const out = typeof flags.out === "string" ? resolve(flags.out) : join(root, PROFILE_DIR, "previews", rel.replace(/\.glb$/, "").replace(/[\\/]/g, "_"));
    const refPath = typeof flags.ref === "string" ? resolve(flags.ref) : undefined;

    if (refPath && !existsSync(refPath)) {
      console.error(`no such reference: ${flags.ref}`);

      return 2;
    }

    const { config, rigPath } = viewerConfig(root, kind, slotName, await itemPreview(root, kind, rel));
    const written = await renderViews({ glbPath: glb, refPath, rigPath, config, out });

    for (const file of Object.values(written)) console.log(`RENDERED ${file}`);

    return 0;
  },

  review: async (argv) => {
    const { positional, flags } = parse(argv, ["project", "ref", "kind", "port", "timeout"]);
    const { root, profile } = requireProject(projectOf(flags));
    const { style } = loadStyle(root);
    const glb = resolve(positional[0] ?? "");

    if (!existsSync(glb)) {
      console.error("usage: polystory review <file.glb> [--ref <other.glb>] [--port n] [--no-open] [--timeout <minutes>]");

      return 2;
    }

    const { name, kind, slotName, rel } = locate(root, profile, glb, typeof flags.kind === "string" ? flags.kind : undefined);
    const reviewDir = join(root, PROFILE_DIR, "review", rel.replace(/\.glb$/, "").replace(/[\\/]/g, "_"));
    const refPath = typeof flags.ref === "string" ? resolve(flags.ref) : undefined;
    const { config, rigPath } = viewerConfig(root, kind, slotName, await itemPreview(root, kind, rel));
    const recipePath = join(kind.recipes, rel.replace(/\.glb$/, ".ts"));
    const status = (): StatusPayload => {
      const verdict = checkFile({ root, profile, style, file: glb, kindName: name });

      return {
        glb,
        model: rel.replace(/\.glb$/, ""),
        kind: name,
        recipe: existsSync(join(root, recipePath)) ? recipePath : "",
        iteration: nextReviewNumber(reviewDir),
        check: { status: verdict.errors.length ? "FAIL" : verdict.warnings.length ? "WARN" : "OK", summary: verdict.summary, warnings: verdict.warnings, errors: verdict.errors },
        mtime: statSync(glb).mtimeMs,
        style: { materials: Object.fromEntries(Object.entries(style?.materials ?? {}).map(([k, v]) => [k, { hex: v.hex }])) },
      };
    };
    const payload: ReviewPayload = await runReview({
      glbPath: glb,
      refPath,
      rigPath,
      config,
      status,
      reviewDir,
      port: typeof flags.port === "string" ? +flags.port : 4876,
      open: !flags["no-open"],
      timeoutMs: (typeof flags.timeout === "string" ? +flags.timeout : 30) * 60 * 1000,
    });
    console.log(`REVIEW ${payload.status} · iteration ${payload.iteration} · ${payload.pins.length} pins${payload.file ? ` · ${relative(root, payload.file)}` : ""}`);

    if (payload.general) console.log(`general: ${payload.general}`);

    for (const pin of payload.pins) console.log(`  ${pin.id}. [${pin.on === "reference" ? "reference: " : ""}${pin.material || "mesh"}]${pin.state && pin.state !== "open" ? ` (${pin.state})` : ""} ${pin.text || "(no text)"} · ${pin.screenshotPath ? relative(root, pin.screenshotPath) : "no screenshot"}`);

    return 0;
  },

  calibrate: async (argv) => {
    const { positional, flags } = parse(argv, ["project", "out"]);
    const root = projectOf(flags);
    const directions = JSON.parse(readFileSync(join(TEMPLATES, "directions.json"), "utf8")) as Record<string, { summary: string; knobs: Style["knobs"]; materials: Style["materials"] }>;
    const which = positional[0] ?? "all";

    if (which === "style") {
      const { root: r } = requireProject(root);
      const style = requireStyle(r);
      const roles = ["base", "accent", "dark", "light", "glow"];
      const aliases = style.calibration ?? {};
      const materials = { ...style.materials };
      const missing = roles.filter((role) => !materials[role] && !materials[aliases[role]]);

      if (missing.length) {
        console.error(`the calibration set needs ${missing.join(", ")}: name them in style.json under "calibration" (role → material)`);

        return 2;
      }

      for (const role of roles) if (!materials[role]) materials[role] = materials[aliases[role]];

      directions.style = { summary: "the project's own style.json", knobs: style.knobs, materials };
    }

    const chosen = which === "all" ? Object.keys(directions).filter((d) => d !== "style") : [which];

    for (const d of chosen) {
      if (!directions[d]) {
        console.error(`no direction ${JSON.stringify(d)}: ${Object.keys(directions).join(", ")}`);

        return 2;
      }
    }

    const outDir = typeof flags.out === "string" ? resolve(flags.out) : join(root ?? process.cwd(), PROFILE_DIR, "calibration");
    const recipe = await loadRecipe(join(TEMPLATES, "recipes", "calibration.ts"));

    for (const d of chosen) {
      const dir = join(outDir, d);
      const style: Style = { schemaVersion: 1, direction: d, knobs: directions[d].knobs, materials: directions[d].materials };
      const result = buildToFile(recipe, style, join(dir, "calibration.glb"), directions[d].knobs);
      console.log(`BUILT ${d} ${JSON.stringify({ tris: result.tris, bytes: result.bytes })}`);
      const written = await renderViews({ glbPath: result.file, config: { mount: "turntable", unitsPerMetre: 1, scaleFigure: false }, out: dir, views: ["front", "quarter"] });

      for (const file of Object.values(written)) console.log(`RENDERED ${file}`);
    }

    console.log(`calibration renders in ${relative(process.cwd(), outDir) || outDir}`);

    return 0;
  },

  open: (argv) => {
    const { positional, flags } = parse(argv, ["project"]);
    const root = projectOf(flags);
    const profile = root && existsSync(join(root, PROFILE_DIR, "profile.json")) ? loadProfile(root).profile : null;
    const glb = resolve(positional[0] ?? "");

    if (!existsSync(glb)) {
      console.error("usage: polystory open <file.glb>");

      return 2;
    }

    const blender = blenderOrExit(profile);
    const expr = `import bpy; bpy.ops.wm.read_homefile(use_empty=True); bpy.ops.import_scene.gltf(filepath=${JSON.stringify(glb)}); bpy.ops.object.select_all(action='SELECT')`;
    const child = spawn(blender, ["--python-expr", expr], { detached: true, stdio: "ignore" });
    child.unref();
    console.log(`opened ${relative(process.cwd(), glb) || glb} in Blender (pid ${child.pid})`);

    return 0;
  },

  export: (argv) => {
    const { positional, flags } = parse(argv, ["project", "out"]);
    const root = projectOf(flags);
    const profile = root && existsSync(join(root, PROFILE_DIR, "profile.json")) ? loadProfile(root).profile : null;
    const glb = resolve(positional[0] ?? "");

    if (!flags.fbx || !existsSync(glb)) {
      console.error("usage: polystory export --fbx <file.glb> [--out <file.fbx>]");

      return 2;
    }

    const out = typeof flags.out === "string" ? resolve(flags.out) : glb.replace(/\.glb$/i, ".fbx");
    const blender = blenderOrExit(profile);
    const expr = `import bpy; bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=${JSON.stringify(glb)}); bpy.ops.export_scene.fbx(filepath=${JSON.stringify(out)}, path_mode='COPY', embed_textures=False)`;
    const result = spawnSync(blender, ["-b", "--factory-startup", "--python-expr", expr], { encoding: "utf8" });

    if (result.status !== 0 || !existsSync(out)) {
      console.error(result.stderr || result.stdout);

      return result.status ?? 1;
    }

    console.log(`EXPORTED ${relative(process.cwd(), out) || out}`);

    return 0;
  },

  guide: (argv) => {
    const name = argv[0];
    const candidates = name ? [join(SKILL, "reference", `${name}.md`), join(TEMPLATES, name), join(TEMPLATES, "recipes", `${name}.ts`), join(TEMPLATES, `${name}.md`), join(TEMPLATES, `${name}.json`)] : [];
    const found = candidates.find((c) => existsSync(c));

    if (!found) {
      console.error("usage: polystory guide <init|style|new|doctor|profile|recipe|craft|slotted|flat|calibration|style.md|profile.json|directions.json>");

      return 2;
    }

    process.stdout.write(readFileSync(found, "utf8"));

    return 0;
  },

  install: (argv) => {
    const { flags } = parse(argv, ["dir"]);
    const target = typeof flags.dir === "string" ? resolve(flags.dir) : join(flags.global ? homedir() : process.cwd(), ".claude", "skills", "polystory");
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync(SKILL, target, { recursive: true });
    console.log(`polystory skill installed at ${target}`);
    console.log(`next: /polystory ${nextStep(gather(findProject()))}`);

    return 0;
  },
};

const [command, ...args] = process.argv.slice(2);

if (!command || !commands[command]) {
  console.error(USAGE);
  process.exit(command ? 2 : 0);
}

process.exit(await commands[command](args));
