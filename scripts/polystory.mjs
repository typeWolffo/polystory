#!/usr/bin/env node
// The one entry point. Every skill calls this; it finds the project, the
// profile and Blender, and composes the Blender command lines so nobody
// has to remember them.
//
//   node polystory.mjs context|doctor|scan|check|build|preview|calibrate|item|register|blender [args]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { runCheck } from "./check.mjs";
import { runContext } from "./context.mjs";
import { runDoctor } from "./doctor.mjs";
import { runScan } from "./scan.mjs";
import { findBlender, findProject, kindOfFile, knobsFor, loadProfile, loadStyle, PROFILE_DIR, projectPath, slotOfFile } from "./lib/profile.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const BLENDER_SCRIPTS = join(HERE, "blender");
const TEMPLATES = join(HERE, "..", "skills", "polystory", "templates");

const USAGE = `usage: polystory <command> [args]

  context                               the project's state, for a skill to read first
  doctor                                can a build run here
  scan [--dirs a,b] [--out file]        measure the GLBs into .polystory/scan.json
  check [--kind k] <glb…>               may these files ship
  build <recipe.py> [--out <glb>]       recipe → GLB → check
  item <recipe.py>                      print the recipe's ITEM as JSON
  register <recipe.py>                  run the kind's register command for the recipe
  preview <glb> [--ref <object>] [--out <dir>] [--samples n] [--kind k]
  calibrate [all|<direction>|style] [--out <dir>]
  blender                               print the Blender binary in use
  guide <name>                          print a reference or template of the skill: init, style, new, doctor, profile, recipe, craft, slotted, flat, style.md, profile.json
  install [-g] [--dir <path>]           copy the polystory skill into .claude/skills/ (project) or ~/.claude/skills/ (-g)
  hook                                  the PostToolUse hook body: reads the tool call on stdin, checks GLBs written under a models folder

Every command takes --project <root>; otherwise the nearest .polystory/ above the working directory is used.`;

function takeProject(argv) {
  const i = argv.indexOf("--project");

  if (i < 0) return { argv, root: findProject() };

  const root = resolve(argv[i + 1]);

  return { argv: argv.filter((_, j) => j !== i && j !== i + 1), root };
}

function requireProject(root) {
  if (!root || !existsSync(join(root, PROFILE_DIR, "profile.json"))) {
    console.error("no .polystory/profile.json above the working directory: run /polystory:init, or pass --project");
    process.exit(2);
  }

  const { profile, problems } = loadProfile(root);

  if (problems.length) {
    console.error(`profile problems:\n  ${problems.join("\n  ")}`);
    process.exit(2);
  }

  return profile;
}

function requireBlender(profile) {
  const blender = findBlender(profile);

  if (!blender) {
    console.error("Blender was not found: install it, or set POLYSTORY_BLENDER or profile.blender");
    process.exit(2);
  }

  return blender;
}

function runBlender(blender, { blend = null, script, args = [], cwd }) {
  const argv = ["-b", "--factory-startup"];

  if (blend) argv.push(blend);

  argv.push("-P", script, "--", ...args);
  const result = spawnSync(blender, argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  return result;
}

function printBlenderOutput(result, showAll = false) {
  const lines = (result.stdout ?? "").split("\n").filter((l) => showAll || /^(BUILT|RENDERED|ITEM|ERROR|WARN|Traceback|  File|\w*Error:|POLYSTORY)/.test(l));

  if (lines.length) console.log(lines.join("\n"));

  if (result.status !== 0 && result.stderr) console.error(result.stderr.split("\n").filter((l) => l.trim() && !/^(Blender|Read prefs|Warning: )/.test(l)).slice(-30).join("\n"));
}

function itemOf(blender, recipe, cwd) {
  const result = runBlender(blender, { script: join(BLENDER_SCRIPTS, "item.py"), args: [recipe], cwd });
  const line = (result.stdout ?? "").split("\n").find((l) => l.startsWith("ITEM "));

  if (!line) {
    printBlenderOutput(result, true);
    console.error(`could not read ITEM from ${recipe}`);
    process.exit(2);
  }

  return JSON.parse(line.slice(5));
}

function outputFor(root, profile, item) {
  const kind = profile.kinds[item.kind];

  if (!kind) {
    console.error(`ITEM.kind ${JSON.stringify(item.kind)} is not one of ${Object.keys(profile.kinds).join(", ")}`);
    process.exit(2);
  }

  if (kind.slots) {
    const slot = kind.slots[item.slot];

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

  return join(projectPath(root, kind.models), `${item.model}.glb`);
}

const commands = {
  context: (argv) => runContext(argv),
  doctor: (argv) => runDoctor(argv),
  scan: (argv) => runScan(argv),
  check: (argv) => runCheck(argv),

  blender: (argv) => {
    const { root } = takeProject(argv);
    const profile = root && existsSync(join(root, PROFILE_DIR, "profile.json")) ? loadProfile(root).profile : null;
    const blender = findBlender(profile);
    console.log(blender ?? "not found");

    return blender ? 0 : 1;
  },

  item: (argv) => {
    const { argv: rest, root } = takeProject(argv);
    const profile = requireProject(root);
    const recipe = resolve(rest[0] ?? "");

    if (!existsSync(recipe)) {
      console.error("usage: polystory item <recipe.py>");

      return 2;
    }

    console.log(JSON.stringify(itemOf(requireBlender(profile), recipe, root), null, 2));

    return 0;
  },

  build: (argv) => {
    const { argv: rest, root } = takeProject(argv);
    const profile = requireProject(root);
    const { style, problems } = loadStyle(root);

    if (!style || problems.length) {
      console.error(style ? `style problems:\n  ${problems.join("\n  ")}` : "no .polystory/style.json: run /polystory:style first");

      return 2;
    }

    let out = null;
    let check = true;
    const positional = [];

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--out") out = resolve(rest[++i]);
      else if (rest[i] === "--no-check") check = false;
      else positional.push(rest[i]);
    }

    const recipe = resolve(positional[0] ?? "");

    if (!existsSync(recipe)) {
      console.error("usage: polystory build <recipe.py> [--out <file.glb>] [--no-check]");

      return 2;
    }

    const blender = requireBlender(profile);
    const item = itemOf(blender, recipe, root);
    const target = out ?? outputFor(root, profile, item);
    const knobs = knobsFor(style, item.kind);
    mkdirSync(dirname(target), { recursive: true });
    const result = runBlender(blender, {
      script: join(BLENDER_SCRIPTS, "build.py"),
      args: [recipe, target, JSON.stringify({ knobs, materials: style.materials, item })],
      cwd: root,
    });
    printBlenderOutput(result);

    if (result.status !== 0) return result.status ?? 1;

    return check ? runCheck(["--project", root, "--kind", item.kind, target]) : 0;
  },

  register: (argv) => {
    const { argv: rest, root } = takeProject(argv);
    const profile = requireProject(root);
    const recipe = resolve(rest[0] ?? "");

    if (!existsSync(recipe)) {
      console.error("usage: polystory register <recipe.py>");

      return 2;
    }

    const item = itemOf(requireBlender(profile), recipe, root);
    const kind = profile.kinds[item.kind];
    const target = outputFor(root, profile, item);

    if (!existsSync(target)) {
      console.error(`build first: ${relative(root, target)} does not exist`);

      return 2;
    }

    if (!kind?.register?.command) {
      console.log(kind?.register?.doc ?? `nothing to run: a ${item.kind} is registered by hand`);

      return 0;
    }

    const missing = [];
    const command = kind.register.command.replace(/\{(\w+)\}/g, (_, key) => {
      if (key === "file") return relative(root, target);

      if (item[key] === undefined) missing.push(key);

      return String(item[key] ?? "");
    });

    if (missing.length) {
      console.error(`the register command needs ITEM.${missing.join(", ITEM.")} and the recipe has none`);

      return 2;
    }

    console.log(`$ ${command}`);
    const result = spawnSync(command, { cwd: root, shell: true, stdio: "inherit" });

    return result.status ?? 1;
  },

  preview: (argv) => {
    const { argv: rest, root } = takeProject(argv);
    const profile = requireProject(root);
    let out = null;
    let ref = null;
    let samples = 16;
    let kindName = null;
    const positional = [];

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--out") out = resolve(rest[++i]);
      else if (rest[i] === "--ref") ref = rest[++i];
      else if (rest[i] === "--samples") samples = +rest[++i];
      else if (rest[i] === "--kind") kindName = rest[++i];
      else positional.push(rest[i]);
    }

    const glb = resolve(positional[0] ?? "");

    if (!existsSync(glb)) {
      console.error("usage: polystory preview <file.glb> [--ref <rig object>] [--out <dir>] [--samples n] [--kind k]");

      return 2;
    }

    const located = kindOfFile(root, profile, glb);
    const name = kindName ?? located?.name;
    const kind = profile.kinds[name];

    if (!kind) {
      console.error(`${relative(root, glb)} is not inside a kind's models folder; pass --kind`);

      return 2;
    }

    const slot = located?.name === name ? slotOfFile(kind, located.rel) : null;
    const mount = kind.preview?.mount ?? "turntable";
    const socket = mount === "socket" ? slot?.spec.socket : mount === "beside" ? kind.preview.socket : null;

    if (mount === "socket" && !socket) {
      console.error(`no socket for ${relative(root, glb)}: the slot folder has no socket in the profile`);

      return 2;
    }

    const outDir = out ?? join(root, PROFILE_DIR, "previews", (located?.rel ?? glb).replace(/\.glb$/, "").replace(/[\\/]/g, "_"));
    mkdirSync(outDir, { recursive: true });
    const config = {
      glb,
      out: outDir,
      mount,
      socket,
      ref,
      samples,
      unitsPerMetre: kind.unitsPerMetre,
      rig: kind.rig ? { ...kind.rig, heightUnits: kind.rig.heightUnits ?? null } : null,
      offset: kind.preview?.offset ?? [-0.3, -0.2, 0.15],
      farMetres: kind.preview?.farMetres ?? 7,
      views: kind.preview?.views ?? null,
    };
    const blender = requireBlender(profile);
    const result = runBlender(blender, {
      blend: kind.rig?.blend ? projectPath(root, kind.rig.blend) : null,
      script: join(BLENDER_SCRIPTS, "preview.py"),
      args: [JSON.stringify(config)],
      cwd: root,
    });
    printBlenderOutput(result);

    return result.status ?? 1;
  },

  calibrate: (argv) => {
    const { argv: rest, root } = takeProject(argv);
    const profile = root && existsSync(join(root, PROFILE_DIR, "profile.json")) ? loadProfile(root).profile : null;
    let out = null;
    const positional = [];

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--out") out = resolve(rest[++i]);
      else positional.push(rest[i]);
    }

    const directions = JSON.parse(readFileSync(join(TEMPLATES, "directions.json"), "utf8"));
    const which = positional[0] ?? "all";

    if (which === "style") {
      requireProject(root);
      const { style, problems } = loadStyle(root);

      if (!style || problems.length) {
        console.error(style ? `style problems:\n  ${problems.join("\n  ")}` : "no .polystory/style.json to calibrate: run /polystory:style");

        return 2;
      }

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

    const outDir = out ?? join(root ?? process.cwd(), PROFILE_DIR, "calibration");
    mkdirSync(outDir, { recursive: true });
    const blender = requireBlender(profile);

    for (const d of chosen) {
      const result = runBlender(blender, {
        script: join(BLENDER_SCRIPTS, "calibrate.py"),
        args: [join(TEMPLATES, "recipes", "calibration.py"), join(outDir, d), JSON.stringify({ name: d, ...directions[d] })],
        cwd: root ?? process.cwd(),
      });
      printBlenderOutput(result);

      if (result.status !== 0) return result.status ?? 1;
    }

    console.log(`calibration renders in ${relative(process.cwd(), outDir) || outDir}`);

    return 0;
  },
};

commands.guide = (argv) => {
  const name = argv[0];
  const skill = join(HERE, "..", "skills", "polystory");
  const candidates = name ? [join(skill, "reference", `${name}.md`), join(skill, "templates", name), join(skill, "templates", "recipes", `${name}.py`), join(skill, "templates", `${name}.md`), join(skill, "templates", `${name}.json`)] : [];
  const found = candidates.find((c) => existsSync(c));

  if (!found) {
    console.error("usage: polystory guide <init|style|new|doctor|profile|recipe|craft|slotted|flat|calibration|style.md|profile.json>");

    return 2;
  }

  process.stdout.write(readFileSync(found, "utf8"));

  return 0;
};

commands.install = (argv) => {
  let dir = null;
  let global = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-g" || argv[i] === "--global") global = true;
    else if (argv[i] === "--dir") dir = resolve(argv[++i]);
  }

  const target = dir ?? join(global ? homedir() : process.cwd(), ".claude", "skills", "polystory");
  const source = join(HERE, "..", "skills", "polystory");
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`polystory skill installed at ${target}`);
  console.log("in Claude Code it is /polystory; other agents: npx skills add typeWolffo/polystory");
  console.log("the GLB hook is not part of a skill install; to add it, put this under hooks.PostToolUse in .claude/settings.json:");
  console.log(JSON.stringify({ matcher: "Bash", hooks: [{ type: "command", command: "npx -y polystory hook", timeout: 30 }] }));

  return 0;
};

commands.hook = () => {
  const result = spawnSync(process.execPath, [join(HERE, "hook-glb.mjs")], { stdio: "inherit" });

  return result.status ?? 0;
};

const [command, ...args] = process.argv.slice(2);

if (!command || !commands[command]) {
  console.error(USAGE);
  process.exit(command ? 2 : 0);
}

process.exit(commands[command](args));
